import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  MiniMap,
  useReactFlow,
  useNodesState,
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

function composerMentionRange(value, cursor) {
  const before = String(value || "").slice(0, cursor);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  const query = before.slice(start + 1);
  if (/[\s，。；;,.!?！？、]/.test(query)) return null;
  return { start, end: cursor, query: query.trim().toLowerCase() };
}

function canvasAspectRatio(value = "3:4") {
  const [width, height] = String(value).split(":").map(Number);
  return width > 0 && height > 0 ? `${width} / ${height}` : "3 / 4";
}

function ImageNode({ data, selected }) {
  const [splitting, setSplitting] = useState(false);
  const [branding, setBranding] = useState(false);
  const showingDraft = data.displayVersion !== "final" || !data.finalUrl;
  const visibleUrl = showingDraft ? (data.draftUrl || data.url) : data.finalUrl;
  const visibleObjectKey = showingDraft
    ? (data.draftObjectKey || data.objectKey)
    : (data.finalObjectKey || data.objectKey);
  const actionData = { ...data, url: visibleUrl, objectKey: visibleObjectKey };
  const hasVersions = Boolean(data.finalUrl && data.finalUrl !== data.draftUrl);
  const versionLabel = data.optimizationStatus
    ? (showingDraft ? "初稿" : "优化版")
    : (data.label || "图片");
  const toggleVersion = (event) => {
    event.stopPropagation();
    if (!hasVersions) return;
    data.onVersion?.(data.nodeId, showingDraft ? "final" : "draft");
  };
  const download = () => {
    const link = document.createElement("a");
    link.href = visibleUrl;
    link.download = data.name || "kv.png";
    link.click();
  };

  return (
    <div className={`cf-node${selected ? " selected" : ""}`}>
      <button
        type="button"
        className={`cf-version-badge ${showingDraft ? "draft" : "final"}${hasVersions ? " is-switchable" : ""}`}
        onClick={toggleVersion}
        title={hasVersions ? (showingDraft ? "查看优化版" : "查看初稿") : versionLabel}
      >
        <img src="/ui-assets/icon/image.svg" alt="" />
        <span>{versionLabel}</span>
      </button>
      <img src={visibleUrl} alt={data.name || ""} />
      {selected && (
        <div className="cf-node-toolbar">
          <button type="button" onClick={(event) => { event.stopPropagation(); window.open(visibleUrl, "_blank"); }}>
            <span className="hd-badge">HD</span>放大
          </button>
          <button
            type="button"
            disabled={splitting}
            onClick={async (event) => {
              event.stopPropagation();
              if (splitting) return;
              setSplitting(true);
              try { await data.onSplit?.(actionData); } finally { setSplitting(false); }
            }}
          >
            <img src="/ui-assets/icon/canvas-split.svg" alt="" />{splitting ? "拆分中" : "拆分图层"}
          </button>
          <span className="cf-tb-divider" />
          <button type="button" className="cf-toolbar-icon" onClick={(event) => { event.stopPropagation(); download(); }} title="下载">
            <img src="/ui-assets/icon/canvas-download.svg" alt="" />
          </button>
          <span className="cf-tb-divider" />
          <button
            type="button"
            disabled={branding}
            onClick={async (event) => {
              event.stopPropagation();
              if (branding) return;
              setBranding(true);
              try { await data.onBrand?.(actionData); } finally { setBranding(false); }
            }}
          >
            {branding ? "处理中" : "抖音商城logo"}
          </button>
        </div>
      )}
    </div>
  );
}

function LoadingNode({ data }) {
  return (
    <div className="cf-generation-loading" style={{ width: data.width || 260 }}>
      <div className="cf-generation-loading-label">{data.label || "图片正在生成中......"}</div>
      <div className={`cf-generation-loading-card${data.previewUrl ? " has-preview" : ""}`} style={{ aspectRatio: data.aspectRatio || "3 / 4" }}>
        {data.previewUrl ? <img src={data.previewUrl} alt="生成预览" /> : null}
      </div>
    </div>
  );
}

const nodeTypes = { image: ImageNode, loading: LoadingNode };

function CanvasControls({ showMini, onToggleMini }) {
  const { zoomIn, zoomOut } = useReactFlow();
  return (
    <div className="cf-extra-controls">
      <button type="button" className={showMini ? "active" : ""} onClick={onToggleMini} title="缩略图" aria-label="缩略图">
        <img src="/ui-assets/icon/canvas-minimap.png" alt="" />
      </button>
      <span className="cf-control-divider" />
      <button type="button" onClick={() => zoomOut({ duration: 180 })} title="缩小" aria-label="缩小"><img src="/ui-assets/icon/canvas-zoom-out.png" alt="" /></button>
      <button type="button" onClick={() => zoomIn({ duration: 180 })} title="放大" aria-label="放大"><img src="/ui-assets/icon/canvas-zoom-in.png" alt="" /></button>
    </div>
  );
}

let rowCounter = 0;

function CanvasApp() {
  const [nodes, setNodes, applyNodesChange] = useNodesState([]);
  const [messages, setMessages] = useState([]);
  const [chatWidth, setChatWidth] = useState(460);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [showMini, setShowMini] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState(null);
  const [title, setTitle] = useState("Untitled");
  const [editingTitle, setEditingTitle] = useState(false);
  const [composerSettings, setComposerSettings] = useState({
    campaign_name: "",
    campaign_subtitle: "",
    campaign_time: "",
    image_size: "3:4",
    style_preset: "none",
    style_name: "",
    has_skill: false,
    optimization_mode: "smart",
    auto_optimize: true,
  });
  const [flowInstance, setFlowInstance] = useState(null);
  const [composerHasText, setComposerHasText] = useState(false);
  const [composerReferences, setComposerReferences] = useState([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [composerExpanding, setComposerExpanding] = useState(false);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [composerMention, setComposerMention] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [loadingNode, setLoadingNode] = useState(null);
  const [newConversationPending, setNewConversationPending] = useState(false);

  const messagesRef = useRef([]);
  const lastTypoRef = useRef(null);
  const splitLocksRef = useRef(new Set());
  const brandLocksRef = useRef(new Set());
  const optimizationLocksRef = useRef(new Set());
  const chatPanelRef = useRef(null);
  const chatInputRef = useRef(null);
  const nodesRef = useRef([]);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const hydratingRef = useRef(false);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  const nodeSnapshot = useCallback((list) => list.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data },
  })), []);

  const snapshotKey = useCallback((list) => JSON.stringify(list.map((node) => ({
    id: node.id,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    objectKey: node.data?.objectKey || "",
  }))), []);

  const pushHistory = useCallback((snapshot = nodesRef.current) => {
    const next = nodeSnapshot(snapshot);
    const previous = undoStackRef.current.at(-1);
    if (previous && snapshotKey(previous) === snapshotKey(next)) return;
    undoStackRef.current = [...undoStackRef.current.slice(-49), next];
    redoStackRef.current = [];
  }, [nodeSnapshot, snapshotKey]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(nodeSnapshot(nodesRef.current));
    setNodes(nodeSnapshot(previous));
    setSelectedNodeId("");
  }, [nodeSnapshot, setNodes]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(nodeSnapshot(nodesRef.current));
    setNodes(nodeSnapshot(next));
    setSelectedNodeId("");
  }, [nodeSnapshot, setNodes]);

  const onNodesChange = useCallback((changes) => {
    if (changes.some((change) => change.type === "remove")) pushHistory();
    applyNodesChange(changes);
  }, [applyNodesChange, pushHistory]);

  const appendMessage = useCallback((role, content, extra = {}) => {
    const msg = { id: `${Date.now()}-${Math.random()}`, role, content, created_at: new Date().toISOString(), ...extra };
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  }, []);

  const updateStatusMessage = useCallback((content, extra = {}) => {
    const next = messagesRef.current.filter((message) => message.kind !== "status");
    next.push({ id: "generation-status", role: "assistant", kind: "status", content, ...extra });
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const setAllMessages = useCallback((list) => {
    messagesRef.current = list;
    setMessages(list);
  }, []);

  const addImageNode = useCallback((kind, url, name, objectKey, placement = null) => {
    const isTypography = kind === "typography";
    const row = isTypography ? rowCounter++ : Math.max(0, rowCounter - 1);
    const id = `${kind}-${row}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const labels = { typography: "第一步版式图", kv: "完整 KV", title: "标题图层", background: "背景图层" };
    const xByKind = { typography: 80, kv: 420, title: 760, background: 1100 };
    const node = {
      id,
      type: "image",
      position: placement || { x: xByKind[kind] ?? 420, y: 110 + row * 340 },
      data: {
        nodeId: id,
        kind,
        url,
        name,
        objectKey: objectKey || (name ? `outputs/${name}` : ""),
        label: labels[kind] || "完整 KV",
        onSplit: (data) => splitHandlerRef.current(data),
        onBrand: (data) => brandHandlerRef.current(data),
        onVersion: (nodeId, version) => setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, data: { ...item.data, displayVersion: version } } : item)),
        onRetry: (data) => optimizationHandlerRef.current(data.optimizationJobId, true),
      },
    };
    pushHistory();
    setNodes((current) => [...current, node]);
    if (isTypography) {
      lastTypoRef.current = id;
    }
    return node;
  }, [pushHistory, setNodes]);

  const updateOptimizationNode = useCallback((objectKey, patch) => {
    setNodes((current) => current.map((node) => (
      node.data?.objectKey === objectKey || node.data?.draftObjectKey === objectKey
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
  }, [setNodes]);

  const parseSse = useCallback(async (response, context = {}) => {
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
        } else if (event === "optimization_status") {
          updateStatusMessage(payload.message || (payload.status === "reviewing" ? "正在检查画面结构" : "正在优化主视觉关系"));
          const draftKey = payload.job?.draft_image?.object_key;
          if (draftKey) updateOptimizationNode(draftKey, {
            optimizationStatus: payload.status,
            optimizationReason: payload.reason || payload.job?.review_result?.max_problem || "",
          });
        } else if (event === "image_preview") {
          const previewUrl = payload.image_preview?.url;
          if (previewUrl) setLoadingNode((current) => current ? { ...current, data: { ...current.data, previewUrl } } : current);
        } else if (event === "typography") {
          const layer = payload.typography_layer;
          if (layer && !layer.skipped) addImageNode("typography", layer.url, layer.name, layer.object_key);
        } else if (event === "scene") {
          const layer = payload.scene_layer;
          if (layer && !layer.skipped) addImageNode("kv", layer.url, layer.name, layer.object_key, context.outputPosition || null);
        } else if (event === "image") {
          const image = payload.image_result;
          if (image && !image.skipped && image.url) {
            appendMessage("assistant", "", { image: image.url, imageObjectKey: image.object_key || "", imageName: image.name });
          }
        } else if (event === "optimized_image") {
          const image = payload.image_result;
          const job = payload.job;
          const draftKey = job?.draft_image?.object_key || image?.draft_object_key;
          if (image?.url && draftKey) {
            updateOptimizationNode(draftKey, {
              draftObjectKey: draftKey,
              draftUrl: job?.draft_image?.url || "",
              finalUrl: image.url,
              finalObjectKey: image.object_key || "",
              objectKey: image.object_key || draftKey,
              url: image.url,
              name: image.name || "",
              displayVersion: "final",
              optimizationStatus: "completed",
              optimizationReason: job?.review_result?.max_problem || "",
            });
            appendMessage("assistant", "优化完成", {
              image: image.url,
              imageObjectKey: image.object_key || "",
              imageName: image.name,
              optimizationReason: job?.review_result?.max_problem || "",
            });
          }
        } else if (event === "optimization_error") {
          const job = payload.job;
          const draftKey = job?.draft_image?.object_key;
          if (draftKey) updateOptimizationNode(draftKey, {
            optimizationStatus: job?.optimization_status || "failed",
            optimizationJobId: job?.id || "",
          });
          updateStatusMessage(`自动优化未完成，初稿已保留：${payload.message || "可稍后重试"}`, {
            retryOptimizationJobId: job?.id || "",
          });
        } else if (event === "optimization_complete") {
          const job = payload.job;
          const draftKey = job?.draft_image?.object_key;
          if (draftKey) updateOptimizationNode(draftKey, {
            optimizationStatus: job?.optimization_status || "completed",
            optimizationJobId: job?.id || "",
            optimizationReason: job?.review_result?.max_problem || "",
            draftUrl: job?.draft_image?.url || "",
            finalUrl: job?.final_image?.url || job?.draft_image?.url || "",
            finalObjectKey: job?.final_image?.object_key || job?.draft_image?.object_key || "",
            objectKey: job?.final_image?.object_key || job?.draft_image?.object_key || draftKey,
            url: job?.final_image?.url || job?.draft_image?.url || "",
            displayVersion: job?.optimization_triggered ? "final" : "draft",
          });
        } else if (event === "complete") {
          return payload;
        } else if (event === "error") {
          throw new Error(payload.error || "链路运行失败");
        }
      }
    }
    throw new Error("链路中断：服务端未返回完成事件");
  }, [addImageNode, appendMessage, updateStatusMessage, updateOptimizationNode]);

  const runOptimization = useCallback(async (jobId, retry = false) => {
    if (!jobId || optimizationLocksRef.current.has(jobId)) return;
    optimizationLocksRef.current.add(jobId);
    try {
      const response = await fetch(`/api/generation-jobs/${encodeURIComponent(jobId)}/optimize-stream`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ retry }),
      });
      await parseSse(response, { optimization: true });
    } catch (error) {
      updateStatusMessage(`自动优化未完成，初稿已保留：${error.message}`, { retryOptimizationJobId: jobId });
    } finally {
      optimizationLocksRef.current.delete(jobId);
    }
  }, [parseSse, updateStatusMessage]);

  const optimizationHandlerRef = useRef(runOptimization);
  optimizationHandlerRef.current = runOptimization;

  const runGeneration = useCallback(async (payload, files = [], options = {}) => {
    if (generating || !session?.projectId) return;
    const text = String(payload.visual_description || "").trim();
    if (!text) return;
    const baseNode = options.baseNode || null;
    if (baseNode && !baseNode.data?.objectKey) {
      updateStatusMessage("当前选中图片尚未保存，暂时不能继续编辑");
      return;
    }
    const conversationHistory = messagesRef.current
      .filter((message) => message.kind !== "status" && String(message.content || "").trim())
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));
    const outputPosition = baseNode
      ? { x: baseNode.position.x + 340, y: baseNode.position.y }
      : { x: 80, y: 110 };
    setGenerating(true);
    setLoadingNode({
      id: `loading-${Date.now()}`,
      type: "loading",
      position: outputPosition,
      selectable: false,
      draggable: false,
      deletable: false,
      data: {
        label: baseNode ? "正在基于选中图片编辑......" : "图片正在生成中......",
        aspectRatio: canvasAspectRatio(payload.image_size || composerSettings.image_size || "3:4"),
      },
    });
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
        doudou_ip: /兜兜/.test(text) ? "true" : "false",
        include_logo: merged.include_logo ? "true" : "false",
        include_search_overlay: merged.include_search_overlay ? "true" : "false",
        project_id: session.projectId,
        edit_mode: baseNode ? "true" : "false",
        base_image_object_key: baseNode?.data?.objectKey || "",
        conversation_history: JSON.stringify(conversationHistory),
        optimization_mode: merged.optimization_mode || "smart",
        auto_optimize: merged.auto_optimize === false ? "false" : "true",
      };
      for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
      const referenceFiles = files.length ? files : (typeof window.__getReferenceFiles === "function" ? window.__getReferenceFiles() : []);
      const referenceLabels = typeof window.__getReferenceLabels === "function"
        ? window.__getReferenceLabels().slice(0, referenceFiles.length)
        : referenceFiles.map((_, index) => `图${index + 1}`);
      body.append("reference_labels", JSON.stringify(referenceLabels));
      referenceFiles.forEach((file, index) => body.append(`reference_image_${index}`, file, file.name));
      const response = await fetch("/api/run-stream", { method: "POST", headers: authHeaders(), body });
      const result = await parseSse(response, { outputPosition: baseNode ? outputPosition : null });
      const optimization = result?.optimization;
      const draftKey = optimization?.draft_image?.object_key || result?.image_result?.object_key;
      if (draftKey && optimization) {
        updateOptimizationNode(draftKey, {
          draftObjectKey: draftKey,
          draftUrl: optimization.draft_image?.url || result?.image_result?.url || "",
          finalUrl: optimization.final_image?.url || "",
          optimizationStatus: optimization.optimization_status || "pending",
          optimizationJobId: optimization.id || result.optimization_job_id || "",
          displayVersion: "draft",
          onRetry: (data) => optimizationHandlerRef.current(data.optimizationJobId, true),
        });
      }
      if (optimization?.mode === "smart" && optimization?.status === "draft_ready") {
        updateStatusMessage("初稿已完成，正在检查画面结构");
        void runOptimization(optimization.id || result.optimization_job_id);
      } else {
        updateStatusMessage("生成完成");
      }
    } catch (error) {
      updateStatusMessage(`生成失败：${error.message}`);
    } finally {
      setLoadingNode(null);
      setGenerating(false);
    }
  }, [generating, session, composerSettings.image_size, parseSse, appendMessage, updateStatusMessage, updateOptimizationNode, runOptimization]);

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

  const handleBrandOverlay = useCallback(async (data) => {
    const lockKey = data.objectKey || data.name;
    if (generating || !lockKey || brandLocksRef.current.has(lockKey) || !session?.projectId) return;
    const sourceNode = nodesRef.current.find((node) => node.id === data.nodeId || node.data?.objectKey === data.objectKey);
    const outputPosition = sourceNode
      ? { x: sourceNode.position.x + 340, y: sourceNode.position.y }
      : { x: 420, y: 110 };
    brandLocksRef.current.add(lockKey);
    setGenerating(true);
    setLoadingNode({
      id: `loading-brand-${Date.now()}`,
      type: "loading",
      position: outputPosition,
      selectable: false,
      draggable: false,
      deletable: false,
      data: { label: "正在添加抖音商城 Logo......", aspectRatio: canvasAspectRatio(composerSettings.image_size) },
    });
    appendMessage("user", "为选中图片添加抖音商城 Logo 和右下角搜索框");
    updateStatusMessage("正在叠加抖音商城 Logo 与搜索框...");
    try {
      const response = await fetch("/api/assets/brand-overlay", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          project_id: session.projectId,
          element_id: data.nodeId || "",
          object_key: data.objectKey || "",
          campaign_name: title || "",
        }),
      });
      requireInvite(response);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Logo 叠加失败");
      addImageNode("kv", payload.url, payload.name, payload.object_key, outputPosition);
      appendMessage("assistant", "已基于选中图片添加抖音商城 Logo 与搜索框。", {
        image: payload.url,
        imageObjectKey: payload.object_key || "",
        imageName: payload.name,
      });
      updateStatusMessage("Logo 与搜索框添加完成");
    } catch (error) {
      updateStatusMessage(`Logo 叠加失败：${error.message}`);
    } finally {
      setLoadingNode(null);
      setGenerating(false);
      brandLocksRef.current.delete(lockKey);
    }
  }, [generating, session, title, composerSettings.image_size, addImageNode, appendMessage, updateStatusMessage]);

  const brandHandlerRef = useRef(handleBrandOverlay);
  brandHandlerRef.current = handleBrandOverlay;

  const saveCanvas = useCallback(async () => {
    if (!session?.projectId) return;
    const payload = {
      title,
      elements: nodesRef.current.map((node) => ({
        id: node.id,
        kind: node.data?.kind || "kv",
        name: node.data?.name || "",
        object_key: node.data?.objectKey || "",
        draft_object_key: node.data?.draftObjectKey || "",
        final_object_key: node.data?.finalObjectKey || "",
        optimization_job_id: node.data?.optimizationJobId || "",
        optimization_status: node.data?.optimizationStatus || "",
        optimization_reason: node.data?.optimizationReason || "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      })).filter((element) => element.object_key),
      edges: [],
      viewport: viewportRef.current,
      messages: messagesRef.current.map(({ id, role, kind, content, imageObjectKey, imageName, optimizationReason, created_at }) => ({
        id, role, kind, content, image_object_key: imageObjectKey, imageName, optimization_reason: optimizationReason, created_at,
      })),
      settings: typeof window.__getCanvasSettings === "function" ? window.__getCanvasSettings() : {},
      replace_elements: true,
    };
    const response = await fetch(`/api/projects/${encodeURIComponent(session.projectId)}/canvas`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (response) requireInvite(response);
  }, [session, title]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  useEffect(() => {
    const sync = (event) => {
      const settings = event.detail || {};
      setComposerSettings((current) => ({ ...current, ...settings }));
    };
    const syncPrompt = (event) => {
      const value = String(event.detail?.value || "");
      if (chatInputRef.current) chatInputRef.current.value = value;
      window.__canvasPromptValue = value;
      setComposerHasText(Boolean(value.trim()));
    };
    const syncReferences = (event) => {
      setComposerReferences(Array.isArray(event.detail?.references) ? event.detail.references : []);
      setReferencesLoading(Boolean(event.detail?.loading));
    };
    const syncExpand = (event) => setComposerExpanding(Boolean(event.detail?.loading));
    window.addEventListener("refra:canvas-settings", sync);
    window.addEventListener("refra:canvas-prompt", syncPrompt);
    window.addEventListener("refra:canvas-references", syncReferences);
    window.addEventListener("refra:canvas-expand", syncExpand);
    return () => {
      window.removeEventListener("refra:canvas-settings", sync);
      window.removeEventListener("refra:canvas-prompt", syncPrompt);
      window.removeEventListener("refra:canvas-references", syncReferences);
      window.removeEventListener("refra:canvas-expand", syncExpand);
    };
  }, []);

  useEffect(() => {
    window.__startCanvasSession = (init) => {
      rowCounter = 0;
      lastTypoRef.current = null;
      splitLocksRef.current.clear();
      brandLocksRef.current.clear();
      optimizationLocksRef.current.clear();
      undoStackRef.current = [];
      redoStackRef.current = [];
      hydratingRef.current = true;
      setNodes([]);
      setAllMessages([]);
      setSelectedNodeId("");
      setNewConversationPending(false);
      setLoadingNode(null);
      setChatCollapsed(false);
      setShowMini(false);
      setShowSizeMenu(false);
      setComposerMention(null);
      setComposerExpanding(false);
      setReferencesLoading(false);
      setComposerReferences(window.__getReferencePreviews?.() || []);
      const project = init?.project || null;
      setTitle(project?.title || "Untitled");
      const sessionSettings = {
        image_size: "3:4",
        style_preset: "none",
        style_name: "",
        has_skill: false,
        optimization_mode: "smart",
        auto_optimize: true,
        ...(project?.settings || {}),
        ...(init?.autoGenerate ? {
          campaign_name: init.campaign_name || "",
          campaign_subtitle: init.campaign_subtitle || "",
          campaign_time: init.campaign_time || "",
          image_size: init.image_size || "3:4",
          style_preset: init.style_preset || "none",
          optimization_mode: init.optimization_mode || "smart",
          auto_optimize: init.auto_optimize !== false,
        } : {}),
      };
      sessionSettings.has_skill = sessionSettings.style_preset !== "none";
      setComposerSettings(sessionSettings);
      window.__applyCanvasSettings?.(sessionSettings);
      const labels = { typography: "第一步版式图", kv: "完整 KV", title: "标题图层", background: "背景图层" };
      const restored = (project?.elements || []).map((element, index) => ({
        id: element.id,
        type: "image",
        position: {
          x: Number.isFinite(Number(element.x)) ? Number(element.x) : (index % 2 === 0 ? 80 : 420),
          y: Number.isFinite(Number(element.y)) ? Number(element.y) : 110 + Math.floor(index / 2) * 340,
        },
        data: {
          nodeId: element.id,
          kind: element.kind,
          url: element.url || "",
          name: element.name,
          objectKey: element.object_key,
          label: labels[element.kind] || "完整 KV",
          onSplit: (data) => splitHandlerRef.current(data),
          onBrand: (data) => brandHandlerRef.current(data),
          onVersion: (nodeId, version) => setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, data: { ...item.data, displayVersion: version } } : item)),
          onRetry: (data) => optimizationHandlerRef.current(data.optimizationJobId, true),
          draftObjectKey: element.draft_object_key || "",
          draftUrl: element.draft_url || "",
          finalObjectKey: element.final_object_key || "",
          finalUrl: element.final_url || element.url || "",
          optimizationJobId: element.optimization_job_id || "",
          optimizationStatus: element.optimization_status || "",
          optimizationReason: element.optimization_reason || "",
          displayVersion: element.final_object_key ? "final" : "draft",
        },
      }));
      if (restored.length) setNodes(restored);
      setAllMessages((project?.messages || []).map((message) => ({
        id: message.id || `${Date.now()}-${Math.random()}`,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        kind: message.kind,
        image: message.image_url || "",
        imageObjectKey: message.image_object_key || "",
        imageName: message.imageName,
        optimizationReason: message.optimization_reason || "",
      })));
      viewportRef.current = project?.viewport || { x: 0, y: 0, zoom: 1 };
      setSession({ ...init });
      requestAnimationFrame(() => {
        flowInstance?.setViewport(viewportRef.current, { duration: 0 });
        hydratingRef.current = false;
      });
    };
    window.__saveCanvasRequested = () => saveCanvas();
  }, [saveCanvas, setNodes, setAllMessages, flowInstance]);

  useEffect(() => {
    if (!session?.projectId || hydratingRef.current) return undefined;
    const timeout = window.setTimeout(() => saveCanvas(), 900);
    return () => window.clearTimeout(timeout);
  }, [nodes, messages, title, session?.projectId, saveCanvas]);

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
    const imageNodes = nodesRef.current.filter((node) => node.type === "image" && node.data?.objectKey);
    const selectedNode = imageNodes.find((node) => node.id === selectedNodeId || node.selected);
    if (!newConversationPending && imageNodes.length && !selectedNode) {
      updateStatusMessage("请先在画布中选择一张图片，再继续编辑");
      return;
    }
    input.value = "";
    window.__canvasPromptValue = "";
    setComposerHasText(false);
    setComposerMention(null);
    const baseNode = newConversationPending ? null : selectedNode || null;
    setNewConversationPending(false);
    runGeneration({ visual_description: text }, [], { baseNode });
  }, [generating, session, selectedNodeId, newConversationPending, runGeneration, updateStatusMessage]);

  const startNewConversation = useCallback(() => {
    setAllMessages([]);
    setNewConversationPending(true);
    setSelectedNodeId("");
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setComposerMention(null);
    setComposerHasText(false);
    setShowSizeMenu(false);
    window.__canvasPromptValue = "";
    if (chatInputRef.current) {
      chatInputRef.current.value = "";
      chatInputRef.current.focus();
    }
  }, [setAllMessages, setNodes]);

  const handleComposerPaste = useCallback(async (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) return null;
        return file.name ? file : new File([file], `pasted-reference-${Date.now()}-${index + 1}.png`, { type: file.type || "image/png" });
      })
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    await window.__addReferenceFiles?.(files);
  }, []);

  useEffect(() => {
    const handleHistoryKey = (event) => {
      if (!document.body.classList.contains("canvas-mode")) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handleHistoryKey);
    return () => window.removeEventListener("keydown", handleHistoryKey);
  }, [redo, undo]);

  const refreshComposerMention = useCallback((input) => {
    setComposerMention(composerMentionRange(input?.value, input?.selectionStart || 0));
  }, []);

  const insertComposerMention = useCallback((reference) => {
    const input = chatInputRef.current;
    if (!input || !composerMention) return;
    const token = `@${reference.label || `图${reference.index + 1}`} `;
    input.value = `${input.value.slice(0, composerMention.start)}${token}${input.value.slice(composerMention.end)}`;
    const cursor = composerMention.start + token.length;
    window.__canvasPromptValue = input.value;
    setComposerHasText(Boolean(input.value.trim()));
    setComposerMention(null);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
  }, [composerMention]);

  const openComposerMention = useCallback(() => {
    const input = chatInputRef.current;
    if (!input) return;
    setShowModeMenu(false);
    setShowSizeMenu(false);
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const insertion = before.endsWith("@") ? "" : "@";
    input.value = `${before}${insertion}${input.value.slice(end)}`;
    const cursor = start + insertion.length;
    window.__canvasPromptValue = input.value;
    setComposerHasText(Boolean(input.value.trim()));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(cursor, cursor);
      refreshComposerMention(input);
    });
  }, [refreshComposerMention]);

  const mentionReferences = composerMention
    ? composerReferences.filter((reference) => {
        const label = reference.label || `图${reference.index + 1}`;
        return !composerMention.query || `${label} ${reference.name || ""}`.toLowerCase().includes(composerMention.query);
      })
    : [];

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
    const startWidth = chatPanelRef.current?.offsetWidth || 460;
    const onMove = (moveEvent) => setChatWidth(Math.min(640, Math.max(420, startWidth + (startX - moveEvent.clientX))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const chatTitle = [...messages].reverse().find((message) => message.role === "user" && message.content)?.content || "新对话";
  const hasComposerSkill = Boolean(
    composerSettings.has_skill
    || (composerSettings.style_preset && composerSettings.style_preset !== "none"),
  );
  const updateComposerBrief = (field, value) => {
    setComposerSettings((current) => ({ ...current, [field]: value }));
    window.__setCanvasBriefField?.(field, value);
  };

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
          nodes={loadingNode ? [...nodes, loadingNode] : nodes}
          edges={[]}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          onInit={setFlowInstance}
          onNodeDragStart={() => pushHistory()}
          onSelectionChange={({ nodes: selectedNodes }) => setSelectedNodeId(selectedNodes.find((node) => node.type === "image")?.id || "")}
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
        <button type="button" className="cf-chat-expand" onClick={() => setChatCollapsed(false)} title="展开对话" aria-label="展开对话"><img src="/ui-assets/icon/canvas-collapse.png" alt="" /></button>
      ) : (
        <div className="canvas-app-chat" ref={chatPanelRef} style={{ width: chatWidth }}>
          <div className="canvas-chat-resize" onMouseDown={startResize} title="拖拽调整宽度" />
          <div className="cf-chat-head">
            <span className="cf-chat-title">{chatTitle.slice(0, 80)}</span>
            <div className="cf-chat-head-actions">
              <button type="button" className="cf-chat-new" onClick={startNewConversation} title="新建对话" aria-label="新建对话"><img src="/ui-assets/icon/canvas-new-chat.svg" alt="" /></button>
              <button type="button" className="cf-chat-collapse" onClick={() => setChatCollapsed(true)} title="收起" aria-label="收起对话"><img src="/ui-assets/icon/canvas-collapse.png" alt="" /></button>
            </div>
          </div>
          <div className="cf-chat-messages">
            {!messages.length && <div className="cf-chat-empty">今天想创作什么？</div>}
            {messages.map((message) => (
              <div key={message.id} className={`cf-msg-wrap ${message.role}${message.kind === "status" ? " status" : ""}`}>
                {message.content ? <div className="cf-msg">{message.content}</div> : null}
                {message.optimizationReason ? <div className="cf-msg-optimization-reason">已优化：{message.optimizationReason}</div> : null}
                {message.retryOptimizationJobId ? <button type="button" className="cf-msg-retry-optimization" onClick={() => runOptimization(message.retryOptimizationJobId, true)}>重新优化</button> : null}
                {message.image ? <div className="cf-msg cf-msg-image"><img src={message.image} alt={message.imageName || ""} /></div> : null}
              </div>
            ))}
          </div>
          <div className="cf-chat-composer">
            {hasComposerSkill && (
              <div className="cf-composer-brief" aria-label="营销活动信息">
                <label><span>主标题为</span><input value={composerSettings.campaign_name || ""} placeholder="填写活动名称" onChange={(event) => updateComposerBrief("campaign_name", event.target.value)} /><span>，</span></label>
                <label><span>副标题为</span><input value={composerSettings.campaign_subtitle || ""} placeholder="填写副标题" onChange={(event) => updateComposerBrief("campaign_subtitle", event.target.value)} /><span>，</span></label>
                <label><span>活动时间为</span><input value={composerSettings.campaign_time || ""} placeholder="填写活动时间" onChange={(event) => updateComposerBrief("campaign_time", event.target.value)} /></label>
              </div>
            )}
            <div className="cf-composer-row">
              <textarea
                ref={chatInputRef}
                className="cf-composer-input"
                rows={2}
                placeholder="今天我们要创作什么"
                onPaste={handleComposerPaste}
                onChange={(event) => {
                  window.__canvasPromptValue = event.target.value;
                  setComposerHasText(Boolean(event.target.value.trim()));
                  refreshComposerMention(event.target);
                }}
                onClick={(event) => refreshComposerMention(event.currentTarget)}
                onKeyUp={(event) => refreshComposerMention(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && composerMention) {
                    event.preventDefault();
                    setComposerMention(null);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendChat();
                  }
                }}
              />
            </div>
            {composerMention && (
              <div className="cf-composer-mention-menu" role="listbox" aria-label="选择参考图">
                <div className="cf-composer-mention-title">选择参考图（{mentionReferences.length}/{composerReferences.length}）</div>
                {mentionReferences.length ? mentionReferences.map((reference) => (
                  <button
                    type="button"
                    role="option"
                    key={`${reference.label || reference.index}-${reference.name}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertComposerMention(reference)}
                  >
                    <img src={reference.url} alt="" />
                    <span>{reference.label || `图${reference.index + 1}`} - 图片</span>
                  </button>
                )) : <div className="cf-composer-mention-empty">没有匹配的参考图</div>}
              </div>
            )}
            {(referencesLoading || composerReferences.length > 0) && (
              <div className="cf-composer-references" aria-live="polite">
                {composerReferences.map((reference) => (
                  <div className="cf-composer-reference" key={`${reference.label || reference.index}-${reference.name}`} title={reference.name}>
                    <img src={reference.url} alt={reference.name || reference.label || `参考图${reference.index + 1}`} />
                    <span>{reference.label || `图${reference.index + 1}`}</span>
                    <button type="button" onClick={() => window.__removeReferenceFile?.(reference.index)} aria-label={`移除${reference.name || "参考图"}`}>×</button>
                  </div>
                ))}
                {referencesLoading && <span className="cf-reference-loading">处理中…</span>}
              </div>
            )}
            {showSizeMenu && (
              <div className="cf-canvas-size-popover" role="listbox" aria-label="选择比例">
                {["16:9", "9:16", "3:4", "4:3", "1:1"].map((ratio) => (
                  <button
                    type="button"
                    key={ratio}
                    className={composerSettings.image_size === ratio ? "selected" : ""}
                    onClick={() => {
                      window.__setCanvasImageSize?.(ratio);
                      setShowSizeMenu(false);
                    }}
                  >
                    <span className={`size-icon ratio-${ratio.replace(":", "")}`} />{ratio}
                  </button>
                ))}
              </div>
            )}
            <div className="cf-composer-tools">
              <button type="button" className="cf-composer-upload" title="上传参考图" onClick={invokeTool("upload")}><img src="/ui-assets/icon/uploadTrigger.svg" alt="" /></button>
              <button type="button" aria-label={hasComposerSkill ? `已选择技能：${composerSettings.style_name || "技能"}` : "技能"} className={hasComposerSkill ? "active" : ""} onClick={invokeTool("style")}><span className="tool-icon-mask style-picker-icon" aria-hidden="true" /><span className="cf-tool-label">技能</span></button>
              <button type="button" aria-label={`图片比例 ${composerSettings.image_size || "3:4"}`} className={showSizeMenu ? "active" : ""} onClick={() => { setShowModeMenu(false); setComposerMention(null); setShowSizeMenu((value) => !value); }}><span className={`size-icon ratio-${String(composerSettings.image_size || "3:4").replace(":", "")}`} /><span className="cf-tool-label">{composerSettings.image_size || "3:4"}</span></button>
              <button type="button" aria-label={composerExpanding ? "扩写中" : "扩写"} disabled={composerExpanding} onClick={invokeTool("expand")}><img src="/ui-assets/icon/expandDescriptionButton.svg" alt="" /><span className="cf-tool-label">{composerExpanding ? "扩写中" : "扩写"}</span></button>
              <div className="cf-generation-mode-select">
                <button type="button" className="cf-generation-mode-button" aria-label={composerSettings.optimization_mode === "fast" ? "快速生成" : "智能优化"} aria-haspopup="listbox" aria-expanded={showModeMenu} onClick={() => { setShowSizeMenu(false); setComposerMention(null); setShowModeMenu((value) => !value); }}>
                  <span className={`mode-icon ${composerSettings.optimization_mode === "fast" ? "mode-fast" : "mode-smart"}`} aria-hidden="true" />
                  <span className="cf-tool-label">{composerSettings.optimization_mode === "fast" ? "快速生成" : "智能优化"}</span>
                  <span className="mode-chevron" aria-hidden="true" />
                </button>
                {showModeMenu && <div className="cf-generation-mode-popover" role="listbox" aria-label="生成模式">
                  {[{ value: "smart", label: "智能优化" }, { value: "fast", label: "快速生成" }].map((option) => {
                    const selected = (composerSettings.optimization_mode || "smart") === option.value;
                    return <button type="button" key={option.value} className={selected ? "selected" : ""} role="option" aria-selected={selected} onClick={() => { window.__setCanvasOptimizationMode?.(option.value); setShowModeMenu(false); }}>
                      <span className={`mode-icon mode-${option.value}`} aria-hidden="true" /><span>{option.label}</span>
                    </button>;
                  })}
                </div>}
              </div>
              <button type="button" className="cf-composer-mention" title="选择参考图" aria-label="选择参考图" onClick={openComposerMention}><img src="/ui-assets/icon/mention-at.svg" alt="" /></button>
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
