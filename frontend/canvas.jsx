import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
} from "@xyflow/react";

function adminToken() {
  return (localStorage.getItem("refra_admin_token") || "").trim();
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = adminToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function ImageNode({ data, selected }) {
  const download = () => {
    const link = document.createElement("a");
    link.href = data.url;
    link.download = data.name || "kv.png";
    link.click();
  };
  return (
    <div className={`cf-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <img src={data.url} alt={data.name || ""} />
      <div className="cf-node-label">
        <span>{data.label}</span>
        <span>{data.name || ""}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      {selected && (
        <div className="cf-node-toolbar">
          <button type="button" onClick={(event) => { event.stopPropagation(); window.open(data.url, "_blank"); }}>
            <span className="hd-badge">HD</span>放大
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); data.onSplit?.(data); }}>拆分图层</button>
          <span className="cf-tb-divider" />
          <button type="button" onClick={(event) => { event.stopPropagation(); download(); }} title="下载">⬇</button>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { image: ImageNode };

let rowCounter = 0;

function CanvasApp() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [messages, setMessages] = useState([]);
  const [chatWidth, setChatWidth] = useState(360);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [showMini, setShowMini] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState(null);
  const [title, setTitle] = useState("Untitled");
  const [editingTitle, setEditingTitle] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const messagesRef = useRef([]);
  const lastTypoRef = useRef(null);
  const splitBusyRef = useRef(false);
  const chatPanelRef = useRef(null);
  const chatInputRef = useRef(null);
  const nodesRef = useRef([]);

  const appendMessage = useCallback((role, content, extra = {}) => {
    const msg = { id: `${Date.now()}-${Math.random()}`, role, content, created_at: new Date().toISOString(), ...extra };
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  }, []);

  const setAllMessages = useCallback((list) => {
    messagesRef.current = list;
    setMessages(list);
  }, []);

  const addImageNode = useCallback((kind, url, name, objectKey) => {
    const row = rowCounter++;
    const id = `${kind}-${row}-${Date.now()}`;
    const node = {
      id,
      type: "image",
      position: { x: kind === "typography" ? 60 : 380, y: 80 + row * 320 },
      data: {
        kind,
        url,
        name,
        objectKey: objectKey || (name ? `outputs/${name}` : ""),
        label: kind === "typography" ? "第一步版式图" : "完整 KV",
        onSplit: (d) => splitHandlerRef.current(d),
      },
    };
    setNodes((nds) => [...nds, node]);
    if (kind === "typography") {
      lastTypoRef.current = id;
    } else if (lastTypoRef.current) {
      setEdges((eds) => [...eds, { id: `edge-${lastTypoRef.current}-${id}`, source: lastTypoRef.current, target: id, animated: true }]);
    }
  }, [setNodes, setEdges]);

  const parseSse = useCallback(async (response) => {
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        let event = "message";
        let dataLine = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          if (line.startsWith("data: ")) dataLine += line.slice(6);
        }
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine);
        if (event === "status") {
          appendMessage("assistant", payload.message || "");
        } else if (event === "typography") {
          const layer = payload.typography_layer;
          if (layer && !layer.skipped) addImageNode("typography", layer.url, layer.name, layer.object_key);
        } else if (event === "scene") {
          const layer = payload.scene_layer;
          if (layer && !layer.skipped) addImageNode("kv", layer.url, layer.name, layer.object_key);
        } else if (event === "image") {
          const img = payload.image_result;
          if (img && !img.skipped && img.url) {
            appendMessage("assistant", "", { image: img.url, imageName: img.name });
          }
        } else if (event === "complete") {
          return payload;
        } else if (event === "error") {
          throw new Error(payload.error || "链路运行失败");
        }
      }
    }
    throw new Error("链路中断：服务端未返回完成事件");
  }, [addImageNode, appendMessage]);

  const runGeneration = useCallback(async (payload, files = []) => {
    if (generating || !session?.projectId) return;
    setGenerating(true);
    const text = String(payload.visual_description || "").trim();
    appendMessage("user", text);
    fetch(`/api/projects/${encodeURIComponent(session.projectId)}/messages`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ role: "user", content: text }),
    }).catch(() => {});
    const settings = typeof window.__getCanvasSettings === "function" ? window.__getCanvasSettings() : {};
    const merged = { ...settings, ...payload };
    try {
      const body = new FormData();
      const fields = {
        campaign_name: merged.campaign_name || "",
        campaign_subtitle: merged.campaign_subtitle || "",
        campaign_time: merged.campaign_time || "",
        visual_description: text,
        image_size: merged.image_size || "3:4",
        style_preset: merged.style_preset || "none",
        integrated_layout_variant: merged.integrated_layout_variant || "",
        generate_image: "true",
        doudou_ip: merged.doudou_ip ? "true" : "false",
        include_logo: merged.include_logo ? "true" : "false",
        include_search_overlay: merged.include_search_overlay ? "true" : "false",
        project_id: session.projectId,
      };
      for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
      const refFiles = files && files.length ? files : (typeof window.__getReferenceFiles === "function" ? window.__getReferenceFiles() : []);
      for (const file of refFiles) body.append("reference_image", file, file.name);
      const response = await fetch("/api/run-stream", {
        method: "POST",
        headers: authHeaders(),
        body,
      });
      await parseSse(response);
      appendMessage("assistant", "生成完成");
    } catch (error) {
      appendMessage("assistant", `生成失败：${error.message}`);
    } finally {
      setGenerating(false);
    }
  }, [generating, session, parseSse, appendMessage]);

  const handleSplit = useCallback(async (data) => {
    if (splitBusyRef.current) return;
    splitBusyRef.current = true;
    try {
      const response = await fetch("/api/assets/split", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: data.name,
          title: title || "",
          subtitle: session?.campaign_subtitle || "",
          time: session?.campaign_time || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "拆分失败");
      const items = [
        [payload.title_layer?.url, "标题图层", payload.title_layer?.object_key],
        [payload.background_layer?.url, "背景图层", payload.background_layer?.object_key],
      ];
      for (const [url, label, objectKey] of items) {
        if (url) addImageNode("kv", url, label, objectKey);
      }
      appendMessage("assistant", "拆分完成");
    } catch (error) {
      appendMessage("assistant", `拆分失败：${error.message}`);
    } finally {
      splitBusyRef.current = false;
    }
  }, [session, title, addImageNode, appendMessage]);

  const splitHandlerRef = useRef(handleSplit);
  splitHandlerRef.current = handleSplit;

  const saveCanvas = useCallback(async () => {
    if (!session?.projectId) return;
    const payload = {
      title,
      elements: nodesRef.current
        .map((node) => ({
          id: node.id,
          kind: node.data?.kind || "kv",
          name: node.data?.name || "",
          object_key: node.data?.objectKey || "",
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        }))
        .filter((element) => element.object_key),
    };
    await fetch(`/api/projects/${encodeURIComponent(session.projectId)}/canvas`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [session, title]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    window.__startCanvasSession = (init) => {
      rowCounter = 0;
      lastTypoRef.current = null;
      splitBusyRef.current = false;
      setNodes([]);
      setEdges([]);
      setAllMessages([]);
      setSelectedId(null);
      setChatCollapsed(false);
      setShowMini(false);
      const project = init?.project || null;
      setTitle(project?.title || "Untitled");
      const savedElements = project?.elements || [];
      const restored = savedElements.map((element, index) => ({
        id: element.id,
        type: "image",
        position: {
          x: Number.isFinite(Number(element.x)) ? Number(element.x) : (index % 2 === 0 ? 60 : 380),
          y: Number.isFinite(Number(element.y)) ? Number(element.y) : 80 + Math.floor(index / 2) * 320,
        },
        data: {
          kind: element.kind,
          url: element.url || "",
          name: element.name,
          objectKey: element.object_key,
          label: element.kind === "typography" ? "第一步版式图" : "完整 KV",
          onSplit: (d) => splitHandlerRef.current(d),
        },
      }));
      if (restored.length) setNodes(restored);
      const savedMessages = (project?.messages || []).map((message) => ({
        id: message.id || `${Date.now()}-${Math.random()}`,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
      }));
      setAllMessages(savedMessages);
      setSession({ ...init });
    };
    window.__saveCanvasRequested = () => {
      saveCanvas();
    };
  }, [saveCanvas, setNodes, setEdges, setAllMessages]);

  useEffect(() => {
    if (session?.autoGenerate && session.visual_description && !session.__started) {
      session.__started = true;
      runGeneration(session, session.files || []);
    }
  }, [session, runGeneration]);

  const sendChat = useCallback(() => {
    const input = chatInputRef.current;
    const text = (input?.value || "").trim();
    if (!text || generating || !session?.projectId) return;
    input.value = "";
    runGeneration({ visual_description: text }, []);
  }, [generating, session, runGeneration]);

  const commitTitle = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = title.trim();
    if (!trimmed || !session?.projectId) return;
    setTitle(trimmed);
    await fetch(`/api/projects/${encodeURIComponent(session.projectId)}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {});
  }, [session, title]);

  const goHome = useCallback(() => {
    saveCanvas();
    if (typeof showView === "function") showView("generate");
  }, [saveCanvas]);

  const startResize = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatPanelRef.current?.offsetWidth || 360;
    const onMove = (ev) => {
      setChatWidth(Math.min(640, Math.max(280, startWidth + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="canvas-app-shell">
      <div className="canvas-app-main">
        <div className="cf-canvas-title">
          <button type="button" className="cf-canvas-title-icon" onClick={goHome} title="返回主页">▧</button>
          {editingTitle ? (
            <input
              className="cf-canvas-title-input"
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitTitle();
                if (event.key === "Escape") { setTitle(session?.project?.title || "Untitled"); setEditingTitle(false); }
              }}
            />
          ) : (
            <button type="button" className="cf-canvas-title-text" onClick={() => setEditingTitle(true)} title="点击重命名">
              {title || "Untitled"}
            </button>
          )}
        </div>
        <button type="button" className="canvas-app-back" onClick={goHome}>← 返回</button>
        {!nodes.length && <div className="cf-canvas-empty">新建项目 · 输入想法开始创作</div>}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          onSelectionChange={({ nodes: selectedNodes }) => {
            setSelectedId(selectedNodes?.[0]?.id || null);
          }}
        >
          <Background color="#3a3a3a" gap={24} />
          <Controls />
          {showMini && <MiniMap pannable zoomable style={{ background: "#232323" }} />}
        </ReactFlow>
        <div className="cf-extra-controls">
          <button type="button" className={showMini ? "active" : ""} onClick={() => setShowMini((value) => !value)} title="小地图">▦</button>
        </div>
      </div>

      {chatCollapsed ? (
        <button type="button" className="cf-chat-expand" onClick={() => setChatCollapsed(false)} title="展开对话">«</button>
      ) : (
        <div className="canvas-app-chat" ref={chatPanelRef} style={{ width: chatWidth }}>
          <div className="canvas-chat-resize" onMouseDown={startResize} title="拖拽调整宽度" />
          <div className="cf-chat-head">
            <span className="cf-chat-title">{(session?.visual_description || title).slice(0, 40)}</span>
            <button type="button" className="cf-chat-collapse" onClick={() => setChatCollapsed(true)} title="收起">»</button>
          </div>
          <div className="cf-chat-messages">
            {!messages.length && (
              <div className="cf-msg-wrap assistant">
                <div className="cf-msg">输入想法可继续生成新变体；点击画布中的图可使用放大、拆分、下载。</div>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`cf-msg-wrap ${msg.role}`}>
                {msg.content ? <div className="cf-msg">{msg.content}</div> : null}
                {msg.image ? (
                  <div className="cf-msg cf-msg-image">
                    <img src={msg.image} alt={msg.imageName || ""} />
                  </div>
                ) : null}
                {msg.role === "user" && <div className="cf-msg-date">{formatDate(msg.created_at)}</div>}
              </div>
            ))}
          </div>
          <div className="cf-chat-composer">
            <div className="cf-composer-row">
              <button type="button" className="cf-composer-avatar" title="上传参考图" onClick={invokeTool("upload")}>＋</button>
              <textarea
                ref={chatInputRef}
                className="cf-composer-input"
                rows={2}
                placeholder="今天我们要创作什么"
                onChange={(event) => {
                  window.__canvasPromptValue = event.target.value;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendChat();
                  }
                }}
              />
            </div>
            <div className="cf-composer-tools">
              <button type="button" onClick={invokeTool("style")}>风格预设</button>
              <button type="button" onClick={invokeTool("size")}><span>3:4</span></button>
              <button type="button" onClick={invokeTool("expand")}>扩写</button>
              <button type="button" className="cf-composer-send" onClick={sendChat} title="发送">↑</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function invokeTool(action) {
  return (event) => {
    if (typeof window.__canvasTool === "function") window.__canvasTool(action, event);
  };
}

const root = createRoot(document.getElementById("canvasRoot"));
root.render(<CanvasApp />);
