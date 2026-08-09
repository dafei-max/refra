import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  MiniMap,
  useReactFlow,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
} from "@xyflow/react";

function adminToken() {
  return (sessionStorage.getItem("refra_admin_token") || "").trim();
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = adminToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function requireInvite(response) {
  if (response.status !== 401) return;
  sessionStorage.removeItem("refra_admin_token");
  window.__openInviteModal?.();
}

function ImageNode({ data, selected }) {
  const [splitting, setSplitting] = useState(false);
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
          <button
            type="button"
            disabled={splitting}
            onClick={async (event) => {
              event.stopPropagation();
              if (splitting) return;
              setSplitting(true);
              try { await data.onSplit?.(data); } finally { setSplitting(false); }
            }}
          >
            <img src="/ui-assets/icon/canvas-split.svg" alt="" />{splitting ? "拆分中" : "拆分图层"}
          </button>
          <span className="cf-tb-divider" />
          <button type="button" className="cf-toolbar-icon" onClick={(event) => { event.stopPropagation(); download(); }} title="下载">
            <img src="/ui-assets/icon/canvas-download.svg" alt="" />
          </button>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { image: ImageNode };

function CanvasControls({ showMini, onToggleMini }) {
  const { zoomIn, zoomOut } = useReactFlow();
  return (
    <div className="cf-extra-controls">
      <button type="button" className={showMini ? "active" : ""} onClick={onToggleMini} title="缩略图" aria-label="缩略图">
        <span className="cf-minimap-icon" />
      </button>
      <span className="cf-control-divider" />
      <button type="button" onClick={() => zoomOut({ duration: 180 })} title="缩小" aria-label="缩小">−</button>
      <button type="button" onClick={() => zoomIn({ duration: 180 })} title="放大" aria-label="放大">＋</button>
    </div>
  );
}

let rowCounter = 0;

function CanvasApp() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [messages, setMessages] = useState([]);
  const [chatWidth, setChatWidth] = useState(399);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [showMini, setShowMini] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState(null);
  const [title, setTitle] = useState("Untitled");
  const [editingTitle, setEditingTitle] = useState(false);
  const [composerSettings, setComposerSettings] = useState({ image_size: "3:4", style_name: "风格预设" });
  const [flowInstance, setFlowInstance] = useState(null);
  const [composerHasText, setComposerHasText] = useState(false);

  const messagesRef = useRef([]);
  const lastTypoRef = useRef(null);
  const splitLocksRef = useRef(new Set());
  const chatPanelRef = useRef(null);
  const chatInputRef = useRef(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const hydratingRef = useRef(false);

  const appendMessage = useCallback((role, content, extra = {}) => {
    const msg = { id: `${Date.now()}-${Math.random()}`, role, content, created_at: new Date().toISOString(), ...extra };
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  }, []);

  const updateStatusMessage = useCallback((content) => {
    const next = messagesRef.current.filter((message) => message.kind !== "status");
    next.push({ id: "generation-status", role: "assistant", kind: "status", content });
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const setAllMessages = useCallback((list) => {
    messagesRef.current = list;
    setMessages(list);
  }, []);

  const addImageNode = useCallback((kind, url, name, objectKey) => {
    const isTypography = kind === "typography";
    const row = isTypography ? rowCounter++ : Math.max(0, rowCounter - 1);
    const id = `${kind}-${row}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const labels = { typography: "第一步版式图", kv: "完整 KV", title: "标题图层", background: "背景图层" };
    const xByKind = { typography: 80, kv: 420, title: 760, background: 1100 };
    const node = {
      id,
      type: "image",
      position: { x: xByKind[kind] ?? 420, y: 110 + row * 340 },
      data: {
        kind,
        url,
        name,
        objectKey: objectKey || (name ? `outputs/${name}` : ""),
        label: labels[kind] || "完整 KV",
        onSplit: (data) => splitHandlerRef.current(data),
      },
    };
    setNodes((current) => [...current, node]);
    if (isTypography) {
      lastTypoRef.current = id;
    } else if (kind === "kv" && lastTypoRef.current) {
      setEdges((current) => [...current, { id: `edge-${lastTypoRef.current}-${id}`, source: lastTypoRef.current, target: id }]);
    }
  }, [setNodes, setEdges]);

  const parseSse = useCallback(async (response) => {
    requireInvite(response);
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
          updateStatusMessage(payload.message || "正在生成…");
        } else if (event === "typography") {
          const layer = payload.typography_layer;
          if (layer && !layer.skipped) addImageNode("typography", layer.url, layer.name, layer.object_key);
        } else if (event === "scene") {
          const layer = payload.scene_layer;
          if (layer && !layer.skipped) addImageNode("kv", layer.url, layer.name, layer.object_key);
        } else if (event === "image") {
          const image = payload.image_result;
          if (image && !image.skipped && image.url) {
            appendMessage("assistant", "", { image: image.url, imageObjectKey: image.object_key || "", imageName: image.name });
          }
        } else if (event === "complete") {
          return payload;
        } else if (event === "error") {
          throw new Error(payload.error || "链路运行失败");
        }
      }
    }
    throw new Error("链路中断：服务端未返回完成事件");
  }, [addImageNode, appendMessage, updateStatusMessage]);

  const runGeneration = useCallback(async (payload, files = []) => {
    if (generating || !session?.projectId) return;
    const text = String(payload.visual_description || "").trim();
    if (!text) return;
    setGenerating(true);
    appendMessage("user", text);
    fetch(`/api/projects/${encodeURIComponent(session.projectId)}/messages`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ role: "user", content: text }),
    }).then(requireInvite).catch(() => {});
    const currentSettings = typeof window.__getCanvasSettings === "function" ? window.__getCanvasSettings() : {};
    const merged = { ...(session.project?.settings || {}), ...currentSettings, ...payload };
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
      const referenceFiles = files.length ? files : (typeof window.__getReferenceFiles === "function" ? window.__getReferenceFiles() : []);
      for (const file of referenceFiles) body.append("reference_image", file, file.name);
      const response = await fetch("/api/run-stream", { method: "POST", headers: authHeaders(), body });
      await parseSse(response);
      updateStatusMessage("生成完成");
    } catch (error) {
      updateStatusMessage(`生成失败：${error.message}`);
    } finally {
      setGenerating(false);
    }
  }, [generating, session, parseSse, appendMessage, updateStatusMessage]);

  const handleSplit = useCallback(async (data) => {
    const lockKey = data.objectKey || data.name;
    if (!lockKey || splitLocksRef.current.has(lockKey)) return;
    splitLocksRef.current.add(lockKey);
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
      requireInvite(response);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "拆分失败");
      const items = [
        ["title", payload.title_layer?.url, "标题图层", payload.title_layer?.object_key],
        ["background", payload.background_layer?.url, "背景图层", payload.background_layer?.object_key],
      ];
      for (const [kind, url, label, objectKey] of items) if (url) addImageNode(kind, url, label, objectKey);
      updateStatusMessage(payload.reused ? "已载入现有拆分图层" : "拆分完成");
    } catch (error) {
      updateStatusMessage(`拆分失败：${error.message}`);
    } finally {
      splitLocksRef.current.delete(lockKey);
    }
  }, [session, title, addImageNode, updateStatusMessage]);

  const splitHandlerRef = useRef(handleSplit);
  splitHandlerRef.current = handleSplit;

  const saveCanvas = useCallback(async () => {
    if (!session?.projectId) return;
    const payload = {
      title,
      elements: nodesRef.current.map((node) => ({
        id: node.id,
        kind: node.data?.kind || "kv",
        name: node.data?.name || "",
        object_key: node.data?.objectKey || "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      })).filter((element) => element.object_key),
      edges: edgesRef.current.map(({ id, source, target }) => ({ id, source, target })),
      viewport: viewportRef.current,
      messages: messagesRef.current.map(({ id, role, kind, content, imageObjectKey, imageName, created_at }) => ({
        id, role, kind, content, image_object_key: imageObjectKey, imageName, created_at,
      })),
      settings: typeof window.__getCanvasSettings === "function" ? window.__getCanvasSettings() : {},
    };
    const response = await fetch(`/api/projects/${encodeURIComponent(session.projectId)}/canvas`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (response) requireInvite(response);
  }, [session, title]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  useEffect(() => {
    const sync = (event) => setComposerSettings((current) => ({ ...current, ...(event.detail || {}) }));
    const syncPrompt = (event) => {
      const value = String(event.detail?.value || "");
      if (chatInputRef.current) chatInputRef.current.value = value;
      window.__canvasPromptValue = value;
      setComposerHasText(Boolean(value.trim()));
    };
    window.addEventListener("refra:canvas-settings", sync);
    window.addEventListener("refra:canvas-prompt", syncPrompt);
    return () => {
      window.removeEventListener("refra:canvas-settings", sync);
      window.removeEventListener("refra:canvas-prompt", syncPrompt);
    };
  }, []);

  useEffect(() => {
    window.__startCanvasSession = (init) => {
      rowCounter = 0;
      lastTypoRef.current = null;
      splitLocksRef.current.clear();
      hydratingRef.current = true;
      setNodes([]);
      setEdges([]);
      setAllMessages([]);
      setChatCollapsed(false);
      setShowMini(false);
      const project = init?.project || null;
      setTitle(project?.title || "Untitled");
      setComposerSettings({ image_size: "3:4", style_name: "风格预设", ...(project?.settings || {}) });
      window.__applyCanvasSettings?.(project?.settings || {});
      const labels = { typography: "第一步版式图", kv: "完整 KV", title: "标题图层", background: "背景图层" };
      const restored = (project?.elements || []).map((element, index) => ({
        id: element.id,
        type: "image",
        position: {
          x: Number.isFinite(Number(element.x)) ? Number(element.x) : (index % 2 === 0 ? 80 : 420),
          y: Number.isFinite(Number(element.y)) ? Number(element.y) : 110 + Math.floor(index / 2) * 340,
        },
        data: {
          kind: element.kind,
          url: element.url || "",
          name: element.name,
          objectKey: element.object_key,
          label: labels[element.kind] || "完整 KV",
          onSplit: (data) => splitHandlerRef.current(data),
        },
      }));
      if (restored.length) setNodes(restored);
      setEdges((project?.edges || []).map((edge) => ({ ...edge })));
      setAllMessages((project?.messages || []).map((message) => ({
        id: message.id || `${Date.now()}-${Math.random()}`,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        kind: message.kind,
        image: message.image_url || "",
        imageObjectKey: message.image_object_key || "",
        imageName: message.imageName,
      })));
      viewportRef.current = project?.viewport || { x: 0, y: 0, zoom: 1 };
      setSession({ ...init });
      requestAnimationFrame(() => {
        flowInstance?.setViewport(viewportRef.current, { duration: 0 });
        hydratingRef.current = false;
      });
    };
    window.__saveCanvasRequested = () => saveCanvas();
  }, [saveCanvas, setNodes, setEdges, setAllMessages, flowInstance]);

  useEffect(() => {
    if (!session?.projectId || hydratingRef.current) return undefined;
    const timeout = window.setTimeout(() => saveCanvas(), 900);
    return () => window.clearTimeout(timeout);
  }, [nodes, edges, title, session?.projectId, saveCanvas]);

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
    window.__canvasPromptValue = "";
    setComposerHasText(false);
    runGeneration({ visual_description: text }, []);
  }, [generating, session, runGeneration]);

  const commitTitle = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = title.trim();
    if (!trimmed || !session?.projectId) return;
    setTitle(trimmed);
    const response = await fetch(`/api/projects/${encodeURIComponent(session.projectId)}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => null);
    if (response) requireInvite(response);
  }, [session, title]);

  const goHome = useCallback(async () => {
    await saveCanvas();
    if (typeof window.__canvasReturnedHome === "function") window.__canvasReturnedHome();
    else if (typeof showView === "function") showView("generate");
  }, [saveCanvas]);

  const startResize = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatPanelRef.current?.offsetWidth || 399;
    const onMove = (moveEvent) => setChatWidth(Math.min(640, Math.max(280, startWidth + (startX - moveEvent.clientX))));
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
          <button type="button" className="cf-canvas-title-icon" onClick={goHome} title="保存并返回主页">
            <img src="/ui-assets/neo-brand.png" alt="返回主页" />
          </button>
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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onInit={setFlowInstance}
          onMoveEnd={(_, viewport) => { viewportRef.current = viewport; }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={0.1}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#3a3a3a" gap={24} />
          {showMini && (
            <MiniMap
              pannable
              zoomable
              nodeColor="#ebebe9"
              nodeStrokeColor="transparent"
              nodeBorderRadius={2}
              maskColor="transparent"
              maskStrokeColor="transparent"
              style={{ width: 176, height: 106, background: "#fffffd" }}
            />
          )}
          <CanvasControls showMini={showMini} onToggleMini={() => setShowMini((value) => !value)} />
        </ReactFlow>
      </div>

      {chatCollapsed ? (
        <button type="button" className="cf-chat-expand" onClick={() => setChatCollapsed(false)} title="展开对话" aria-label="展开对话">←|</button>
      ) : (
        <div className="canvas-app-chat" ref={chatPanelRef} style={{ width: chatWidth }}>
          <div className="canvas-chat-resize" onMouseDown={startResize} title="拖拽调整宽度" />
          <div className="cf-chat-head">
            <span className="cf-chat-title">{messages.length ? (session?.visual_description || title).slice(0, 40) : "新对话"}</span>
            <button type="button" className="cf-chat-collapse" onClick={() => setChatCollapsed(true)} title="收起" aria-label="收起对话">|→</button>
          </div>
          <div className="cf-chat-messages">
            {!messages.length && <div className="cf-chat-empty">今天想创作什么？</div>}
            {messages.map((message) => (
              <div key={message.id} className={`cf-msg-wrap ${message.role}${message.kind === "status" ? " status" : ""}`}>
                {message.content ? <div className="cf-msg">{message.content}</div> : null}
                {message.image ? <div className="cf-msg cf-msg-image"><img src={message.image} alt={message.imageName || ""} /></div> : null}
              </div>
            ))}
          </div>
          <div className="cf-chat-composer">
            <div className="cf-composer-row">
              <textarea
                ref={chatInputRef}
                className="cf-composer-input"
                rows={2}
                placeholder="今天我们要创作什么"
                onChange={(event) => {
                  window.__canvasPromptValue = event.target.value;
                  setComposerHasText(Boolean(event.target.value.trim()));
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
              <button type="button" className="cf-composer-upload" title="上传参考图" onClick={invokeTool("upload")}>＋</button>
              <button type="button" onClick={invokeTool("style")}><img src="/ui-assets/fengge.png" alt="" />{composerSettings.style_name || "风格预设"}</button>
              <button type="button" onClick={invokeTool("size")}><span className={`size-icon ratio-${String(composerSettings.image_size || "3:4").replace(":", "")}`} />{composerSettings.image_size || "3:4"}</button>
              <button type="button" onClick={invokeTool("expand")}><img src="/ui-assets/size.png" alt="" />扩写</button>
              <button type="button" className={`cf-composer-send${composerHasText ? " active" : ""}`} onClick={sendChat} title="发送">
                <img src="/ui-assets/runButton.png" alt="" />
              </button>
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
