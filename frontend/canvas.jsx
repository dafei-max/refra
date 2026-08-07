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
          <button type="button" onClick={() => window.open(data.url, "_blank")}>
            <span className="hd-badge">HD</span>放大
          </button>
          <button type="button" onClick={() => data.onSplit?.(data)}>拆分图层</button>
          <span className="cf-tb-divider" />
          <button type="button" onClick={download} title="下载">⬇</button>
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
  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState(null);
  const messagesRef = useRef([]);
  const lastTypoRef = useRef(null);
  const chatPanelRef = useRef(null);

  const appendMessage = useCallback((role, content, extra = {}) => {
    const msg = { id: `${Date.now()}-${Math.random()}`, role, content, created_at: new Date().toISOString(), ...extra };
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  }, []);

  const addImageNode = useCallback((kind, url, name) => {
    const row = rowCounter++;
    const id = `${kind}-${row}-${Date.now()}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "image",
        position: { x: kind === "typography" ? 60 : 380, y: 80 + row * 320 },
        data: {
          kind,
          url,
          name,
          label: kind === "typography" ? "第一步版式图" : "完整 KV",
          onSplit: (d) => handleSplit(d),
        },
      },
    ]);
    if (kind === "typography") {
      lastTypoRef.current = id;
    } else if (lastTypoRef.current) {
      const edgeId = `edge-${lastTypoRef.current}-${id}`;
      setEdges((eds) => [...eds, { id: edgeId, source: lastTypoRef.current, target: id, animated: true }]);
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
          if (layer && !layer.skipped) addImageNode("typography", layer.url, layer.name);
        } else if (event === "scene") {
          const layer = payload.scene_layer;
          if (layer && !layer.skipped) addImageNode("kv", layer.url, layer.name);
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
    if (generating) return;
    setGenerating(true);
    appendMessage("user", payload.visual_description);
    try {
      const body = new FormData();
      const fields = {
        campaign_name: payload.campaign_name || "",
        campaign_subtitle: payload.campaign_subtitle || "",
        campaign_time: payload.campaign_time || "",
        visual_description: payload.visual_description || "",
        image_size: payload.image_size || "3:4",
        style_preset: payload.style_preset || "none",
        integrated_layout_variant: payload.integrated_layout_variant || "",
        generate_image: "true",
        doudou_ip: payload.doudou_ip ? "true" : "false",
        include_logo: payload.include_logo ? "true" : "false",
        include_search_overlay: payload.include_search_overlay ? "true" : "false",
      };
      for (const [key, value] of Object.entries(fields)) body.append(key, value);
      for (const file of files || []) body.append("reference_image", file, file.name);
      const response = await fetch("/api/run-stream", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken()}` },
        body,
      });
      await parseSse(response);
      appendMessage("assistant", "生成完成，可在画布中查看。");
    } catch (error) {
      appendMessage("assistant", `生成失败：${error.message}`);
    } finally {
      setGenerating(false);
    }
  }, [generating, parseSse, appendMessage]);

  const handleSplit = useCallback(async (data) => {
    try {
      const response = await fetch("/api/assets/split", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({
          name: data.name,
          title: session?.campaign_name || "",
          subtitle: session?.campaign_subtitle || "",
          time: session?.campaign_time || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "拆分失败");
      const items = [
        [payload.title_layer?.url, "标题图层"],
        [payload.background_layer?.url, "背景图层"],
      ];
      for (const [url, label] of items) {
        if (url) {
          addImageNode("kv", url, label);
        }
      }
      appendMessage("assistant", "拆分完成：标题/背景图层已加入画布。");
    } catch (error) {
      appendMessage("assistant", `拆分失败：${error.message}`);
    }
  }, [session, addImageNode, appendMessage]);

  useEffect(() => {
    if (session && session.visual_description && !session.__started) {
      session.__started = true;
      runGeneration(session, session.files || []);
    }
  }, [session, runGeneration]);

  const sendChat = useCallback(() => {
    const input = chatInputRef.current;
    const text = (input?.value || "").trim();
    if (!text || generating || !session) return;
    input.value = "";
    runGeneration({
      ...session,
      visual_description: text,
      files: [],
    }, []);
  }, [generating, session, runGeneration]);

  const chatInputRef = useRef(null);

  const startResize = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatPanelRef.current?.offsetWidth || 360;
    const onMove = (ev) => {
      const next = Math.min(640, Math.max(280, startWidth + (startX - ev.clientX)));
      setChatWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const resetSession = useCallback(() => {
    rowCounter = 0;
    setNodes([]);
    setEdges([]);
    messagesRef.current = [];
    setMessages([]);
    setSession(null);
    if (typeof showView === "function") showView("generate");
  }, [setNodes, setEdges]);

  useEffect(() => {
    window.__startCanvasSession = (init) => {
      rowCounter = 0;
      setNodes([]);
      setEdges([]);
      messagesRef.current = [];
      setMessages([]);
      setSession({ ...init });
    };
  }, [setNodes, setEdges]);

  return (
    <div className="canvas-app-shell">
      <div className="canvas-app-main">
        <button type="button" className="canvas-app-back" onClick={resetSession}>← 返回</button>
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
        >
          <Background color="#3a3a3a" gap={24} />
          <Controls />
          <MiniMap pannable zoomable style={{ background: "#232323" }} />
        </ReactFlow>
      </div>
      <div className="canvas-app-chat" ref={chatPanelRef} style={{ width: chatWidth }}>
        <div className="canvas-chat-resize" onMouseDown={startResize} title="拖拽调整宽度" />
        <div className="cf-chat-head">{(session?.visual_description || "设计对话").slice(0, 40)}</div>
        <div className="cf-chat-messages">
          {!messages.length && <div className="cf-msg-wrap assistant"><div className="cf-msg">输入想法可继续生成新变体；点击画布中的图可使用放大、拆分、下载。</div></div>}
          {messages.map((msg) => (
            <div key={msg.id} className={`cf-msg-wrap ${msg.role}`}>
              {msg.content ? <div className="cf-msg">{msg.content}</div> : null}
              {msg.image ? (
                <div className="cf-msg cf-msg-image">
                  <img src={msg.image} alt={msg.imageName || ""} />
                </div>
              ) : null}
              <div className="cf-msg-date">{formatDate(msg.created_at)}</div>
            </div>
          ))}
        </div>
        <div className="cf-chat-composer">
          <div className="cf-composer-row">
            <button type="button" className="cf-composer-avatar" title="上传参考图">＋</button>
            <textarea
              ref={chatInputRef}
              className="cf-composer-input"
              rows={2}
              placeholder="今天我们要创作什么"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
          </div>
          <div className="cf-composer-tools">
            <button type="button">风格预设</button>
            <button type="button"><span>3:4</span></button>
            <button type="button">扩写</button>
            <button type="button" className="cf-composer-send" onClick={sendChat} title="发送">↑</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("canvasRoot"));
root.render(<CanvasApp />);
