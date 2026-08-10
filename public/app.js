const form = document.querySelector("#briefForm");
const runButton = document.querySelector("#runButton");
const errorBox = document.querySelector("#errorBox");
const resultView = document.querySelector("#resultView");
const ADMIN_TOKEN_KEY = "refra_admin_token";
const recentProjects = document.querySelector("#recentProjects");
const homeInspiration = document.querySelector("#homeInspiration");
const recentProjectsMore = document.querySelector("#recentProjectsMore");
const homeInspirationMore = document.querySelector("#homeInspirationMore");
const inviteButton = document.querySelector("#inviteButton");
const inviteModal = document.querySelector("#inviteModal");
const inviteTokenInput = document.querySelector("#inviteTokenInput");
const inviteTokenDisplay = document.querySelector("#inviteTokenDisplay");
const inviteEyeButton = document.querySelector("#inviteEyeButton");
const inviteEyeIcon = document.querySelector("#inviteEyeIcon");
const inviteError = document.querySelector("#inviteError");
const inviteConfirmButton = document.querySelector("#inviteConfirmButton");
const projectsGrid = document.querySelector("#projectsGrid");
const homeInspirationTabs = document.querySelector("#homeInspirationTabs");
const projectActionModal = document.querySelector("#projectActionModal");
const projectActionTitle = document.querySelector("#projectActionTitle");
const projectRenameField = document.querySelector("#projectRenameField");
const projectRenameInput = document.querySelector("#projectRenameInput");
const projectDeleteCopy = document.querySelector("#projectDeleteCopy");
const projectActionError = document.querySelector("#projectActionError");
const projectActionCancel = document.querySelector("#projectActionCancel");
const projectActionConfirm = document.querySelector("#projectActionConfirm");

// Scrub tokens left by builds that used persistent storage. Current credentials are tab-scoped only.
try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}

function adminToken() {
  return (sessionStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
}

function authHeaders(extra = {}) {
  const headers = { ...(extra || {}) };
  const token = adminToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: authHeaders(options.headers) });
  if (response.status === 401) {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    window.__openInviteModal?.();
  }
  return response;
}
const assetsButton = document.querySelector("#assetsButton");
const styleButton = document.querySelector("#styleButton");
const libraryButton = document.querySelector("#libraryButton");
const generateButton = document.querySelector("#generateButton");
const assetsList = document.querySelector("#assetsList");
const styleList = document.querySelector("#styleList");
const styleMessage = document.querySelector("#styleMessage");
const libraryTabs = document.querySelector("#libraryTabs");
const libraryList = document.querySelector("#libraryList");
const libraryMessage = document.querySelector("#libraryMessage");
const materialFilters = document.querySelector("#materialFilters");
const materialDesignTypeFilter = document.querySelector("#materialDesignTypeFilter");
const materialSourceFilter = document.querySelector("#materialSourceFilter");
const materialOrientationFilter = document.querySelector("#materialOrientationFilter");
const materialFilterReset = document.querySelector("#materialFilterReset");
const inspirationSearchForm = document.querySelector("#inspirationSearchForm");
const inspirationSearchInput = document.querySelector("#inspirationSearchInput");
const inspirationSearchButton = document.querySelector("#inspirationSearchButton");
const inspirationSection = document.querySelector("#inspirationSection");
const inspirationTitle = document.querySelector("#inspirationTitle");
const inspirationSummary = document.querySelector("#inspirationSummary");
const inspirationStatus = document.querySelector("#inspirationStatus");
const inspirationList = document.querySelector("#inspirationList");
const inspirationClearButton = document.querySelector("#inspirationClearButton");
const referenceImageInput = document.querySelector("#referenceImageInput");
const uploadTrigger = document.querySelector("#uploadTrigger");
const visualDescriptionInput = document.querySelector("#visualDescriptionInput");
const expandDescriptionButton = document.querySelector("#expandDescriptionButton");
const doudouIpButton = document.querySelector("#doudouIpButton");
const doudouIpInput = document.querySelector("#doudouIpInput");
const includeLogoButton = document.querySelector("#includeLogoButton");
const includeSearchOverlayButton = document.querySelector("#includeSearchOverlayButton");
const stylePresetSection = document.querySelector("#stylePresetSection");
const stylePresetInput = document.querySelector("#stylePresetInput");
const integratedLayoutInput = document.querySelector("#integratedLayoutInput");
const stylePickerButton = document.querySelector("#stylePickerButton");
const stylePickerIcon = document.querySelector("#stylePickerIcon");
const stylePickerLabel = document.querySelector("#stylePickerLabel");
const sizePickerButton = document.querySelector("#sizePickerButton");
const sizePopover = document.querySelector("#sizePopover");
const imageSizeInput = document.querySelector("#imageSizeInput");
const sizeText = document.querySelector("#sizeText");
const sizeIcon = document.querySelector("#sizeIcon");
const mentionMenu = document.querySelector("#mentionMenu");
const referenceStrip = document.querySelector("#referenceStrip");
const generationStory = document.querySelector("#generationStory");
const storyTitle = document.querySelector("#storyTitle");
const storyDescription = document.querySelector("#storyDescription");
const storyReferences = document.querySelector("#storyReferences");
const stageAccordions = document.querySelector("#stageAccordions");
const campaignNameInput = document.querySelector("#campaignNameInput");
const campaignSubtitleInput = document.querySelector("#campaignSubtitleInput");
const campaignTimeInput = document.querySelector("#campaignTimeInput");
const styleFolderInput = document.querySelector("#styleFolderInput");
const materialDetailModal = document.querySelector("#materialDetailModal");
const materialDetailImage = document.querySelector("#materialDetailImage");
const materialDetailType = document.querySelector("#materialDetailType");
const materialDetailCategory = document.querySelector("#materialDetailCategory");
const materialDetailDescription = document.querySelector("#materialDetailDescription");
const materialDetailSource = document.querySelector("#materialDetailSource");
const materialSameButton = document.querySelector("#materialSameButton");
const materialUseReferenceButton = document.querySelector("#materialUseReferenceButton");
const materialDeleteButton = document.querySelector("#materialDeleteButton");
const inspirationPreviewModal = document.querySelector("#inspirationPreviewModal");
const inspirationPreviewImage = document.querySelector("#inspirationPreviewImage");
const inspirationPreviewFallback = document.querySelector("#inspirationPreviewFallback");
const inspirationPreviewType = document.querySelector("#inspirationPreviewType");
const inspirationPreviewTitle = document.querySelector("#inspirationPreviewTitle");
const inspirationPreviewDescription = document.querySelector("#inspirationPreviewDescription");
const inspirationPreviewSource = document.querySelector("#inspirationPreviewSource");
const inspirationPreviewAuthorRow = document.querySelector("#inspirationPreviewAuthorRow");
const inspirationPreviewAuthor = document.querySelector("#inspirationPreviewAuthor");
const inspirationPreviewQuery = document.querySelector("#inspirationPreviewQuery");
const inspirationPreviewDimensions = document.querySelector("#inspirationPreviewDimensions");
const inspirationPreviewLink = document.querySelector("#inspirationPreviewLink");
const inspirationSaveButton = document.querySelector("#inspirationSaveButton");
const inspirationSaveTags = document.querySelector("#inspirationSaveTags");
const inspirationSaveMessage = document.querySelector("#inspirationSaveMessage");
const inspirationRoleInputs = [...document.querySelectorAll(".reference-role-options input[type='checkbox']")];

const ASSET_RECORD_KEY = "kv_asset_records_v2";
const ratioOptions = ["3:4", "4:3", "1:1", "16:9", "9:16"];
const LEGACY_MATERIAL_ROLES = {
  "完整案例": "完整案例",
  "字体": "字体标题",
  "字体标题": "字体标题",
  "构图": "构图版式",
  "构图版式": "构图版式",
  "风格": "风格质感",
  "质感": "风格质感",
  "风格质感": "风格质感",
  "元素": "元素主体",
  "主体": "元素主体",
  "元素主体": "元素主体",
  "色彩": "色彩氛围",
  "氛围": "色彩氛围",
  "色彩氛围": "色彩氛围",
  "场景": "场景空间",
  "空间": "场景空间",
  "场景空间": "场景空间",
};

let allMaterials = [];
let canvasAppLoadPromise = null;
let allStylePresets = [];
let activeIntegratedLayoutTab = "vertical";
let activeMaterialTab = "全部";
let referenceFiles = [];
let isExpandingDescription = false;
let activeMaterial = null;
let inspirationItems = [];
let activeInspiration = null;
let lastInspirationKeyword = "";
let inspirationRequestSerial = 0;
let activeProjectAction = null;
let stageState = {
  brief: { label: "Brief理解", status: "idle", content: "" },
  creative: { label: "创意策略", status: "idle", content: "" },
  references: { label: "参考图选择", status: "idle", content: "" },
  design: { label: "设计判断", status: "idle", content: "" },
  preflight: { label: "生成前评审", status: "idle", content: "" },
  prompt: { label: "最终生图prompt", status: "idle", content: "" },
  quality: { label: "成图评审", status: "idle", content: "" },
};

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function uniqueTextList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,，、;；|\n]+/);
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
}

function materialRoles(item) {
  const explicit = uniqueTextList(item?.reference_roles).map((role) => LEGACY_MATERIAL_ROLES[role] || role);
  const legacy = LEGACY_MATERIAL_ROLES[String(item?.type || "").trim()];
  return [...new Set([...explicit, ...(legacy ? [legacy] : [])])];
}

function materialOrientation(item) {
  const tagged = uniqueTextList(item?.layout_tags).find((tag) => ["横版", "竖版", "方形"].includes(tag));
  if (tagged) return tagged;
  const width = Number(item?.width) || 0;
  const height = Number(item?.height) || 0;
  if (!width || !height) return "";
  if (width > height * 1.08) return "横版";
  if (height > width * 1.08) return "竖版";
  return "方形";
}

function inspirationSource(item) {
  return String(item?.source || "pinterest").toLowerCase();
}

function inspirationSourceName(item) {
  return inspirationSource(item) === "behance" ? "Behance" : "Pinterest";
}

function inspirationSourceUrl(item) {
  return String(item?.sourceUrl || item?.source_url || item?.pinUrl || "");
}

function inspirationSourceId(item) {
  return String(item?.sourceId || item?.source_id || item?.id || "");
}

function savedInspirationMaterial(item) {
  const source = inspirationSource(item);
  const sourceId = inspirationSourceId(item);
  const sourceUrl = inspirationSourceUrl(item);
  return allMaterials.find((material) => (
    material.source === source
    && ((sourceId && String(material.source_id) === sourceId) || (sourceUrl && material.source_url === sourceUrl))
  ));
}

function setError(message) {
  errorBox.textContent = message || "";
  errorBox.classList.toggle("hidden", !message);
}

function isRecoverableModelWarning(message) {
  return /临时结构化|JSON 不完整|模型返回的 JSON 不完整|模型没有返回 JSON/.test(String(message || ""));
}

function setLoading(isLoading) {
  runButton.disabled = isLoading;
  runButton.classList.toggle("loading", isLoading);
}

function setExpandLoading(isLoading) {
  expandDescriptionButton.disabled = isLoading;
  expandDescriptionButton.querySelector("span:last-child").textContent = isLoading ? "扩写中" : "扩写";
  window.dispatchEvent(new CustomEvent("refra:canvas-expand", { detail: { loading: isLoading } }));
}

function setDoudouIpEnabled(enabled) {
  doudouIpInput.value = enabled ? "true" : "false";
  doudouIpButton.classList.toggle("active", enabled);
  doudouIpButton.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function isToolToggleEnabled(button) {
  return button.getAttribute("aria-pressed") === "true";
}

function setToolToggleEnabled(button, enabled) {
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function autoResizeDescription() {
  const styles = getComputedStyle(visualDescriptionInput);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22.4;
  const minHeight = Number.parseFloat(styles.minHeight) || 48;
  const maxHeight = lineHeight * 5;
  visualDescriptionInput.style.height = "0px";
  const contentHeight = visualDescriptionInput.scrollHeight;
  const nextHeight = Math.max(minHeight, Math.min(contentHeight, maxHeight));
  visualDescriptionInput.style.height = `${nextHeight}px`;
  visualDescriptionInput.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

function showView(view) {
  document.querySelectorAll(".neo-page").forEach((page) => {
    page.classList.toggle("active", page.id === `${view}Page`);
  });
  document.querySelectorAll(".rail-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view);
  });
  document.body.classList.toggle("canvas-mode", view === "canvas");
}

function styleNameShort(name) {
  return String(name || "").replace("手绘", "").replace("风格", "").replace("预设", "").trim();
}

function normalizedLayoutOrientation(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["horizontal", "landscape", "横版"].includes(normalized)) return "horizontal";
  if (["vertical", "portrait", "竖版"].includes(normalized)) return "vertical";
  return "";
}

function preferredLayoutTabForSize(value = imageSizeInput.value) {
  return ["16:9", "4:3"].includes(value) ? "horizontal" : "vertical";
}

function selectedStylePreset() {
  return allStylePresets.find((item) => item.id === (stylePresetInput.value || "none")) || null;
}

function integratedLayoutsForPreset(preset = selectedStylePreset()) {
  return Array.isArray(preset?.integrated_layouts) ? preset.integrated_layouts : [];
}

function selectedIntegratedLayout(preset = selectedStylePreset()) {
  const selectedId = integratedLayoutInput.value.trim();
  return integratedLayoutsForPreset(preset).find((item) => item.variant_id === selectedId) || null;
}

function syncStylePickerButton() {
  const current = stylePresetInput.value || "none";
  const preset = allStylePresets.find((item) => item.id === current);
  const isPreset = preset && preset.id !== "none";
  stylePickerIcon.src = isPreset && preset.thumbnail ? preset.thumbnail : "/ui-assets/fengge.png";
  stylePickerIcon.alt = isPreset ? preset.name : "";
  stylePickerIcon.classList.toggle("preset-thumb", Boolean(isPreset && preset.thumbnail));
  stylePickerLabel.textContent = isPreset ? styleNameShort(preset.name) : "风格预设";
  window.dispatchEvent(new CustomEvent("refra:canvas-settings", { detail: window.__getCanvasSettings?.() || {} }));
}

function setSelectedStyle(id) {
  const nextId = id || "none";
  if (stylePresetInput.value !== nextId) integratedLayoutInput.value = "";
  stylePresetInput.value = nextId;
  activeIntegratedLayoutTab = preferredLayoutTabForSize();
  const availableOrientations = new Set(
    integratedLayoutsForPreset().map((item) => normalizedLayoutOrientation(item.orientation)).filter(Boolean),
  );
  if (availableOrientations.size && !availableOrientations.has(activeIntegratedLayoutTab)) {
    activeIntegratedLayoutTab = availableOrientations.has("vertical") ? "vertical" : "horizontal";
  }
  renderStylePresetCards();
  syncStylePickerButton();
}

function closeStylePresetModal() {
  stylePresetSection.classList.add("hidden");
}

function openStylePresetModal() {
  const selectedLayout = selectedIntegratedLayout();
  activeIntegratedLayoutTab = normalizedLayoutOrientation(selectedLayout?.orientation)
    || preferredLayoutTabForSize();
  renderStylePresetCards();
  stylePresetSection.classList.remove("hidden");
}

function renderStylePresetCards() {
  const current = stylePresetInput.value || "none";
  const preset = selectedStylePreset();
  const layouts = integratedLayoutsForPreset(preset);
  const selectedLayoutId = integratedLayoutInput.value.trim();
  const tabLayouts = layouts.filter((item) => normalizedLayoutOrientation(item.orientation) === activeIntegratedLayoutTab);
  const hasHorizontal = layouts.some((item) => normalizedLayoutOrientation(item.orientation) === "horizontal");
  const hasVertical = layouts.some((item) => normalizedLayoutOrientation(item.orientation) === "vertical");
  stylePresetSection.innerHTML = `
    <div class="style-modal-panel" role="dialog" aria-modal="true" aria-label="选择风格与整合版式">
      <header class="style-modal-header">
        <h2>风格</h2>
        <button type="button" class="style-modal-close" data-close-style-modal aria-label="关闭">
          <img src="/ui-assets/style-modal-close.png" alt="" aria-hidden="true" />
        </button>
      </header>
      <div class="style-modal-scroll">
        <div class="style-modal-grid">
          ${allStylePresets
            .map((item) => {
              const selected = item.id === current;
              const media = item.thumbnail
                ? `<img src="${item.thumbnail}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" />`
                : `<span class="empty-preset">无预设</span>`;
              return `
                <article class="style-modal-card${selected ? " selected" : ""}">
                  <div class="style-modal-media">
                    ${media}
                    <button type="button" class="style-apply-button" data-style-preset="${escapeHtml(item.id)}">应用</button>
                  </div>
                  <strong>${escapeHtml(styleNameShort(item.name))}</strong>
                  <p>${escapeHtml(item.subtitle || "")}</p>
                </article>
              `;
            })
            .join("")}
        </div>
        ${preset && preset.id !== "none" && layouts.length
          ? `
            <section class="integrated-layout-section">
              <h3>整合版式</h3>
              <div class="integrated-layout-tabs" role="tablist" aria-label="版式方向">
                <button type="button" class="${activeIntegratedLayoutTab === "horizontal" ? "active" : ""}" data-layout-tab="horizontal"${hasHorizontal ? "" : " disabled"}>横版</button>
                <button type="button" class="${activeIntegratedLayoutTab === "vertical" ? "active" : ""}" data-layout-tab="vertical"${hasVertical ? "" : " disabled"}>竖版</button>
              </div>
              <div class="integrated-layout-grid ${activeIntegratedLayoutTab}">
                ${tabLayouts.length
                  ? tabLayouts.map((item) => `
                      <article class="integrated-layout-card${item.variant_id === selectedLayoutId ? " selected" : ""}">
                        <div class="integrated-layout-media">
                          <img src="${item.image}" alt="${escapeHtml(item.style_name || "整合版式")}" />
                          <button type="button" class="layout-apply-button" data-integrated-layout="${escapeHtml(item.variant_id)}">应用</button>
                        </div>
                      </article>
                    `).join("")
                  : `<p class="integrated-layout-empty">当前风格暂无${activeIntegratedLayoutTab === "horizontal" ? "横版" : "竖版"}参考图</p>`}
              </div>
            </section>
          `
          : ""}
      </div>
    </div>
  `;
  stylePresetSection.querySelector("[data-close-style-modal]")?.addEventListener("click", closeStylePresetModal);
  stylePresetSection.querySelector(".style-modal-panel")?.addEventListener("click", (event) => event.stopPropagation());
  stylePresetSection.querySelectorAll("[data-style-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedStyle(button.dataset.stylePreset || "none");
    });
  });
  stylePresetSection.querySelectorAll("[data-layout-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeIntegratedLayoutTab = button.dataset.layoutTab || "vertical";
      renderStylePresetCards();
    });
  });
  stylePresetSection.querySelectorAll("[data-integrated-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      integratedLayoutInput.value = button.dataset.integratedLayout || "";
      renderStylePresetCards();
      closeStylePresetModal();
    });
  });
}

function renderSizePicker() {
  const current = imageSizeInput.value || "3:4";
  sizePopover.innerHTML = `
    <div class="picker-title">选择比例</div>
    <div class="size-picker-row">
      ${ratioOptions
        .map(
          (ratio) => `
            <button type="button" class="size-choice${current === ratio ? " selected" : ""}" data-size-value="${ratio}">
              <span class="size-icon ratio-${ratio.replace(":", "")}"></span><span>${ratio}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
  sizePopover.querySelectorAll("[data-size-value]").forEach((button) => {
    button.addEventListener("click", () => {
      setImageSize(button.dataset.sizeValue || "3:4");
      sizePopover.classList.add("hidden");
    });
  });
}

function setImageSize(value) {
  imageSizeInput.value = value;
  sizeText.textContent = value;
  sizeIcon.className = `size-icon ratio-${value.replace(":", "")}`;
  renderSizePicker();
  if (!integratedLayoutInput.value) activeIntegratedLayoutTab = preferredLayoutTabForSize(value);
  if (!stylePresetSection.classList.contains("hidden")) renderStylePresetCards();
  window.dispatchEvent(new CustomEvent("refra:canvas-settings", { detail: window.__getCanvasSettings?.() || {} }));
}

function referenceLabel(index) {
  return `图${index + 1}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

const REFERENCE_UPLOAD_MAX_TOTAL = 600 * 1024;
const REFERENCE_COMPRESS_ATTEMPTS = [
  { type: "image/webp", quality: 0.85, maxDim: 1280 },
  { type: "image/jpeg", quality: 0.8, maxDim: 1280 },
  { type: "image/jpeg", quality: 0.65, maxDim: 1024 },
];

function referenceBytesUsed() {
  return referenceFiles.reduce((sum, item) => sum + (item.file?.size || 0), 0);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片无法解析，请更换文件"));
    };
    img.src = url;
  });
}

function encodeImageBlob(img, { type, quality, maxDim }) {
  const sourceWidth = img.naturalWidth || img.width || 1;
  const sourceHeight = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function compressedReferenceName(name, type) {
  const ext = type === "image/webp" ? ".webp" : ".jpg";
  return `${String(name || "reference").replace(/\.[a-z0-9]+$/i, "")}${ext}`;
}

async function compressReferenceFile(file, budget) {
  if (file.size <= budget) {
    return { file, dataUrl: await fileToDataUrl(file) };
  }
  const img = await loadImageElement(file);
  for (const attempt of REFERENCE_COMPRESS_ATTEMPTS) {
    const blob = await encodeImageBlob(img, attempt);
    if (blob && blob.size <= budget) {
      const out = new File([blob], compressedReferenceName(file.name, attempt.type), { type: attempt.type });
      return { file: out, dataUrl: await fileToDataUrl(out) };
    }
  }
  throw new Error(`参考图压缩后仍超过剩余空间（约 ${Math.max(1, Math.round(budget / 1024))}KB），请减少参考图数量或更换更小的图片`);
}

function renderReferenceStrip() {
  referenceStrip.classList.toggle("hidden", !referenceFiles.length);
  referenceStrip.innerHTML = referenceFiles
    .map(
      (item, index) => `
        <div class="reference-chip">
          <img src="${item.url}" alt="${referenceLabel(index)}" />
          <span>${referenceLabel(index)}</span>
          <button type="button" data-remove-reference="${index}" title="移除${referenceLabel(index)}">×</button>
        </div>
      `,
    )
    .join("");

  referenceStrip.querySelectorAll("[data-remove-reference]").forEach((button) => {
    button.addEventListener("click", () => {
      removeReferenceFile(Number(button.dataset.removeReference));
    });
  });

  window.dispatchEvent(new CustomEvent("refra:canvas-references", {
    detail: { loading: false, references: canvasReferencePreviews() },
  }));
}

function canvasReferencePreviews() {
  return referenceFiles.map((item, index) => ({
    index,
    name: item.file?.name || referenceLabel(index),
    url: item.url || item.dataUrl || "",
  }));
}

function removeReferenceFile(index) {
  if (!Number.isInteger(index) || index < 0 || index >= referenceFiles.length) return;
  const [removed] = referenceFiles.splice(index, 1);
  if (removed?.url?.startsWith("blob:")) URL.revokeObjectURL(removed.url);
  renderReferenceStrip();
  renderMentionMenu();
}

async function addReferenceFiles(files) {
  window.dispatchEvent(new CustomEvent("refra:canvas-references", {
    detail: { loading: true, references: canvasReferencePreviews() },
  }));
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const prepared = await compressReferenceFile(file, REFERENCE_UPLOAD_MAX_TOTAL - referenceBytesUsed());
      referenceFiles.push({
        file: prepared.file,
        url: URL.createObjectURL(prepared.file),
        dataUrl: prepared.dataUrl,
      });
    } catch (error) {
      setError(error.message);
    }
  }
  referenceImageInput.value = "";
  renderReferenceStrip();
}

function materialDescription(item) {
  return String(item?.reference_description || item?.Reference || "").trim();
}

function materialFileName(item, contentType = "") {
  const sourceName = decodeURIComponent(String(item?.image || "").split("?")[0].split("/").pop() || "");
  const sourceExtension = sourceName.match(/\.(png|jpe?g|webp|gif)$/i)?.[0];
  const typeExtension = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  }[contentType];
  return `${item?.number || "material-reference"}${sourceExtension || typeExtension || ".png"}`;
}

async function addMaterialReference(item) {
  if (!item?.image) throw new Error("当前素材没有可用图片。");
  const existingIndex = referenceFiles.findIndex(
    (reference) => reference.source === "material" && reference.materialNumber === item.number,
  );
  if (existingIndex >= 0) return existingIndex;

  const response = await fetch(item.image);
  if (!response.ok) throw new Error(`素材图片读取失败（${response.status}）`);
  const sourceBlob = await response.blob();
  const contentType = sourceBlob.type || "image/png";
  if (!contentType.startsWith("image/")) throw new Error("当前素材文件不是有效图片。");
  const file = new File([sourceBlob], materialFileName(item, contentType), { type: contentType });
  const prepared = await compressReferenceFile(file, REFERENCE_UPLOAD_MAX_TOTAL - referenceBytesUsed());
  referenceFiles.push({
    file: prepared.file,
    url: item.image,
    dataUrl: prepared.dataUrl,
    source: "material",
    materialNumber: item.number,
  });
  renderReferenceStrip();
  renderMentionMenu();
  return referenceFiles.length - 1;
}

function openGenerateComposer({ focusDescription = true } = {}) {
  showView("generate");
  requestAnimationFrame(() => {
    form.scrollIntoView({ block: "end", behavior: "smooth" });
    if (!focusDescription) return;
    visualDescriptionInput.focus();
    visualDescriptionInput.setSelectionRange(
      visualDescriptionInput.value.length,
      visualDescriptionInput.value.length,
    );
  });
}

function insertAtCursor(textarea, text, replaceFrom = textarea.selectionStart, replaceTo = textarea.selectionEnd) {
  const value = textarea.value;
  textarea.value = `${value.slice(0, replaceFrom)}${text}${value.slice(replaceTo)}`;
  const cursor = replaceFrom + text.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
}

function mentionStartIndex() {
  const cursor = visualDescriptionInput.selectionStart;
  const before = visualDescriptionInput.value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return -1;
  const query = before.slice(at + 1);
  if (/[\s，。；;,.!?！？、]/.test(query)) return -1;
  return at;
}

function renderMentionMenu() {
  const start = mentionStartIndex();
  if (start < 0) {
    mentionMenu.classList.add("hidden");
    mentionMenu.innerHTML = "";
    return;
  }
  const options = [
    `<button type="button" data-mention-value="@主体" class="mention-option mention-create"><span>+</span><strong>创建主体</strong></button>`,
    ...referenceFiles.map(
      (item, index) => `
        <button type="button" data-mention-value="@${referenceLabel(index)}" class="mention-option">
          <img src="${item.url}" alt="${referenceLabel(index)}" />
          <span>${referenceLabel(index)} - 图片</span>
        </button>
      `,
    ),
  ];
  mentionMenu.innerHTML = `<div class="mention-title">可能@的内容</div>${options.join("")}`;
  mentionMenu.classList.remove("hidden");
  mentionMenu.querySelectorAll("[data-mention-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const cursor = visualDescriptionInput.selectionStart;
      insertAtCursor(visualDescriptionInput, `${button.dataset.mentionValue} `, start, cursor);
      mentionMenu.classList.add("hidden");
    });
  });
}

function resetStages() {
  stageState = {
    brief: { label: "Brief理解", status: "running", content: "正在理解 Brief..." },
    creative: { label: "创意策略", status: "idle", content: "等待 Brief 结果..." },
    references: { label: "参考图选择", status: "idle", content: "等待创意方案..." },
    design: { label: "设计判断", status: "idle", content: "等待参考图选择..." },
    preflight: { label: "生成前评审", status: "idle", content: "等待设计大纲..." },
    prompt: { label: "最终生图prompt", status: "idle", content: "等待 Prompt 生成..." },
    typography: { label: "第一步版式图", status: "idle", content: "等待 Prompt..." },
    scene: { label: "第二步完整 KV", status: "idle", content: "等待第一步版式图..." },
    compose: { label: "品牌固定图层", status: "idle", content: "等待最终 KV..." },
    quality: { label: "成图评审", status: "idle", content: "等待成图..." },
  };
  renderStageAccordions();
}

function renderStageAccordions() {
  stageAccordions.innerHTML = Object.entries(stageState)
    .map(([key, item]) => {
      const suffix = item.status === "running" ? "..." : "";
      const expanded = key === "prompt" && item.status === "done";
      return `
        <details class="stage-item" ${expanded ? "open" : ""}>
          <summary><span>${escapeHtml(item.label)}${suffix}</span><span class="stage-arrow">›</span></summary>
          <pre>${escapeHtml(item.content || "等待运行")}</pre>
        </details>
      `;
    })
    .join("");
}

function renderStoryHeader() {
  const title = campaignNameInput.value.trim();
  const subtitle = campaignSubtitleInput.value.trim();
  const time = campaignTimeInput.value.trim();
  const description = visualDescriptionInput.value.trim();
  storyTitle.textContent = [title, subtitle, time].filter(Boolean).join(" · ") || description.slice(0, 28) || "本次生成";
  storyDescription.textContent = description;
  storyReferences.innerHTML = referenceFiles
    .map((item, index) => `<img src="${item.url}" alt="${referenceLabel(index)}" />`)
    .join("");
  generationStory.classList.remove("hidden");
}

function renderResult(imageResult) {
  if (!imageResult || imageResult.skipped) {
    resultView.className = "generated-result empty-state";
    resultView.textContent = imageResult?.reason || "未生成图片";
    return;
  }
  resultView.className = "generated-result";
  resultView.innerHTML = `<img src="${imageResult.url}" alt="Generated KV" />`;
}

function renderPerformance(performance) {
  if (!performance || !Number.isFinite(Number(performance.total_ms))) return;
  const totalSeconds = Math.max(0, Math.round(Number(performance.total_ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const duration = minutes ? `${minutes}分${String(seconds).padStart(2, "0")}秒` : `${seconds}秒`;
  resultView.querySelector(".generation-performance")?.remove();
  resultView.insertAdjacentHTML(
    "beforeend",
    `<div class="generation-performance"><span>生成用时 ${duration}</span><span>${performance.mode === "fast" ? "快速模式" : "质量模式"}</span></div>`,
  );
}

function renderGeneratingPlaceholder() {
  resultView.className = "generated-result generating-placeholder";
  resultView.innerHTML = `
    <div class="generated-loading-card" aria-label="正在生成图片">
      <div class="loading-dot-field" aria-hidden="true"></div>
      <div class="loading-status">
        <span class="loading-pulse"></span>
        <span>正在生成图片</span>
      </div>
    </div>
  `;
}

function applyStage(event, payload) {
  if (event === "status") return;
  if (event === "brief") {
    stageState.brief = { label: "Brief理解", status: "done", content: pretty(payload.brief) };
    stageState.creative = { label: "创意策略", status: "running", content: "正在生成并筛选 3 个创意方向..." };
    renderStageAccordions();
    return;
  }
  if (event === "creative") {
    stageState.creative = { label: "创意策略", status: "done", content: pretty(payload.creative_plan) };
    stageState.references = { label: "参考图选择", status: "running", content: "正在依据选定创意匹配参考图..." };
    renderStageAccordions();
    return;
  }
  if (event === "references") {
    stageState.references = {
      label: "参考图选择",
      status: "done",
      content: pretty({
        selection_method: payload.selection_method,
        selected_references: payload.selected_references,
        candidate_audit: payload.candidate_audit,
      }),
    };
    stageState.design = { label: "设计判断", status: "running", content: "正在生成可执行设计大纲..." };
    renderStageAccordions();
    return;
  }
  if (event === "design") {
    stageState.design = { label: "设计判断", status: "done", content: pretty(payload.design) };
    stageState.preflight = { label: "生成前评审", status: "running", content: "正在检查创意、层级与参考图证据..." };
    renderStageAccordions();
    return;
  }
  if (event === "preflight") {
    stageState.preflight = { label: "生成前评审", status: "done", content: pretty(payload.preflight_review) };
    stageState.prompt = { label: "最终生图prompt", status: "running", content: "正在生成最终 Prompt..." };
    renderStageAccordions();
    return;
  }
  if (event === "prompt") {
    stageState.prompt = { label: "最终生图prompt", status: "done", content: payload.final_prompt || "" };
    stageState.typography = { label: "第一步版式图", status: "running", content: "正在生成固定文字版式图..." };
    stageState.scene = { label: "第二步完整 KV", status: "idle", content: "等待第一步版式图..." };
    stageState.compose = { label: "品牌固定图层", status: "idle", content: "等待最终 KV..." };
    renderStageAccordions();
    return;
  }
  if (event === "typography") {
    stageState.typography = {
      label: "第一步版式图",
      status: "done",
      content: pretty(payload.typography_layer),
    };
    stageState.scene = {
      label: "第二步完整 KV",
      status: "running",
      content: "正在将第一步成图作为固定参考，只在空白区域生成主体与场景...",
    };
    renderStageAccordions();
    return;
  }
  if (event === "scene") {
    stageState.scene = {
      label: "第二步完整 KV",
      status: "done",
      content: pretty(payload.scene_layer),
    };
    renderStageAccordions();
    return;
  }
  if (event === "compose") {
    stageState.compose = {
      label: "品牌固定图层",
      status: payload.status === "done" ? "done" : "running",
      content: payload.status === "done"
        ? "最终 KV 已完成，并已按勾选项处理品牌固定图层。"
        : payload.message || "正在处理品牌固定图层...",
    };
    renderStageAccordions();
    return;
  }
  if (event === "image") {
    renderResult(payload.image_result);
    if (!["layered", "two-stage-reference"].includes(payload.image_result?.generation_mode)) {
      const reason = payload.image_result?.skipped
        ? payload.image_result.reason || "本次未生成图层。"
        : "本次使用紧凑单步生成。";
      stageState.typography = { label: "第一步版式图", status: "done", content: reason };
      stageState.scene = { label: "第二步完整 KV", status: "done", content: reason };
      stageState.compose = { label: "品牌固定图层", status: "done", content: reason };
    }
    if (!payload.image_result?.skipped) {
      stageState.quality = { label: "成图评审", status: "running", content: "正在进行美术总监成图评审..." };
    }
    renderStageAccordions();
    return;
  }
  if (event === "quality") {
    stageState.quality = {
      label: `成图评审${payload.iteration > 1 ? `（第 ${payload.iteration} 版）` : ""}`,
      status: "done",
      content: pretty(payload.quality_review),
    };
    renderStageAccordions();
    return;
  }
  if (event === "warning") {
    const message = payload.message || "模型调用失败，已使用临时结构化结果。";
    if (!isRecoverableModelWarning(message)) setError(message);
    return;
  }
  if (event === "complete") {
    renderPerformance(payload.performance);
    saveAssetRecord(payload);
    return;
  }
  if (event === "error") throw new Error(payload.error || "链路运行失败");
}

async function runStream(data) {
  const response = await apiFetch("/api/run-stream", { method: "POST", body: data });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `链路运行失败（HTTP ${response.status}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
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
      if (dataLine) {
        const parsed = JSON.parse(dataLine);
        if (event === "complete") completed = true;
        applyStage(event, parsed);
      }
    }
  }
  if (!completed) throw new Error("链路中断：服务端未返回完成事件（可能超时或实例被回收）");
}

async function expandDescription() {
  if (isExpandingDescription) return;
  const source = visualDescriptionInput.value.trim();
  if (!source) {
    setError("先写一句画面描述，再扩写。");
    visualDescriptionInput.focus();
    return;
  }
  setError("");
  isExpandingDescription = true;
  setExpandLoading(true);
  try {
    const payload = {
      campaign_name: campaignNameInput.value.trim(),
      campaign_subtitle: campaignSubtitleInput.value.trim(),
      campaign_time: campaignTimeInput.value.trim(),
      visual_description: source,
      image_size: imageSizeInput.value,
      style_preset: stylePresetInput.value,
      reference_labels: referenceFiles.map((_, index) => referenceLabel(index)),
      doudou_ip: /兜兜/.test(source),
      include_logo: isToolToggleEnabled(includeLogoButton),
      include_search_overlay: isToolToggleEnabled(includeSearchOverlayButton),
    };
    const response = await apiFetch("/api/expand-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "扩写失败");
    visualDescriptionInput.value = result.expanded_description || source;
    window.dispatchEvent(new CustomEvent("refra:canvas-prompt", { detail: { value: visualDescriptionInput.value } }));
    autoResizeDescription();
    visualDescriptionInput.focus();
    visualDescriptionInput.setSelectionRange(visualDescriptionInput.value.length, visualDescriptionInput.value.length);
    renderMentionMenu();
    if (result.warning) setError(result.warning);
  } catch (error) {
    setError(error.message);
  } finally {
    isExpandingDescription = false;
    setExpandLoading(false);
  }
}

function readAssetRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSET_RECORD_KEY) || "[]");
    const list = (Array.isArray(parsed) ? parsed : []).map(normalizeAssetRecord);
    const seen = new Set();
    const result = [];
    for (const item of list) {
      const key = item.object_key || `name:${item.name || ""}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  } catch {
    return [];
  }
}

function writeAssetRecords(records) {
  try {
    localStorage.setItem(ASSET_RECORD_KEY, JSON.stringify(records.slice(-80)));
  } catch {
    localStorage.setItem(ASSET_RECORD_KEY, JSON.stringify(records.map((item) => ({ ...item, references: [] })).slice(-80)));
  }
}

function assetNameFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return decodeURIComponent(raw.split(/[?#]/)[0].split("/").pop() || "");
}

function normalizeAssetRecord(record) {
  const item = { ...record };
  const rawName = String(item.name || "").trim();
  if (!rawName || rawName.includes("?") || /^https?:\/\//i.test(rawName)) {
    item.name = String(item.object_key || "").split("/").pop() || assetNameFromUrl(item.url);
  }
  return item;
}

function saveAssetRecord(result) {
  const image = result?.image_result;
  if (!image?.url || image.skipped) return;
  const name = String(image.name || "").trim() || assetNameFromUrl(image.url);
  const record = {
    name,
    url: image.url,
    object_key: image.object_key || "",
    title: result.request?.campaign_name || campaignNameInput.value.trim(),
    subtitle: result.request?.campaign_subtitle || campaignSubtitleInput.value.trim(),
    time: result.request?.campaign_time || campaignTimeInput.value.trim(),
    description: result.request?.visual_description || visualDescriptionInput.value.trim(),
    references: referenceFiles.slice(0, 6).map((item) => item.dataUrl || item.url),
    creative_plan: result.creative_plan || null,
    preflight_review: result.preflight_review || null,
    quality_review: result.quality_review || null,
    retrieval: result.retrieval || null,
    generation_mode: image.generation_mode || "one-shot",
    layers: image.layers || null,
    created_at: new Date().toISOString(),
  };
  const records = readAssetRecords().filter((item) => {
    if (image.object_key && item.object_key) return item.object_key !== image.object_key;
    return item.name !== name && item.url !== image.url;
  });
  records.push(record);
  writeAssetRecords(records);
}

async function deleteAsset(rawName) {
  const name = assetNameFromUrl(rawName) || String(rawName || "").trim();
  if (!name) throw new Error("缺少要删除的资产名称");
  const response = await apiFetch(`/api/assets/${encodeURIComponent(name)}`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;
  const fallback = await apiFetch("/api/assets/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const fallbackPayload = await fallback.json().catch(() => ({}));
  if (!fallback.ok) throw new Error(fallbackPayload.error || payload.error || "删除失败，请确认服务已重启");
  return fallbackPayload;
}

async function splitAsset(item) {
  const response = await apiFetch("/api/assets/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: item.name,
      title: item.title || "",
      subtitle: item.subtitle || "",
      time: item.time || "",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "拆分失败");
  return payload;
}

function saveAssetSplitResult(item, splitResult) {
  const records = readAssetRecords();
  const index = records.findIndex((record) => record.name === item.name || record.url === item.url);
  const split = {
    title_layer: {
      url: splitResult.title_layer?.url || "",
      transparent_url: splitResult.title_layer?.transparent_url || "",
    },
    background_layer: {
      url: splitResult.background_layer?.url || "",
    },
    split_package: splitResult.split_package || null,
    created_at: new Date().toISOString(),
  };
  if (index >= 0) {
    records[index] = { ...records[index], split };
  } else {
    records.push({ ...item, split, created_at: new Date().toISOString() });
  }
  writeAssetRecords(records);
}

function renderAssets(items) {
  const records = readAssetRecords();
  const merged = items.map((asset) => {
    const record = records.find((item) => (
      (item.object_key && asset.object_key)
        ? item.object_key === asset.object_key
        : (item.name === asset.name || item.url === asset.url)
    )) || {};
    return { ...record, ...asset, url: asset.url || record.url };
  });
  const known = new Set(merged.map((item) => item.object_key || item.name || item.url));
  records.forEach((record) => {
    if (!known.has(record.object_key || record.name || record.url)) merged.push({ ...record, local_only: true });
  });
  const timestamp = (item) => {
    const value = item.created_at || item.modified_at || "";
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const ordered = merged.sort((a, b) => timestamp(b) - timestamp(a));
  if (!ordered.length) {
    assetsList.className = "asset-timeline empty-state";
    assetsList.textContent = "暂无生成资产";
    return;
  }
  assetsList.className = "asset-timeline";
  assetsList.innerHTML = ordered
    .map(
      (item) => `
        <article class="asset-record">
          <div class="asset-copy">
            <h2>${escapeHtml(item.title || item.name || "未命名资产")}</h2>
            ${item.subtitle ? `<p class="asset-subtitle">${escapeHtml(item.subtitle)}</p>` : ""}
            ${item.time ? `<p class="asset-time">${escapeHtml(item.time)}</p>` : ""}
            <div class="asset-ref-row">
              ${(item.references || []).map((src) => `<img src="${src}" alt="上传图" />`).join("")}
            </div>
            <p>${escapeHtml(item.description || "未记录画面描述")}</p>
            ${item.layers ? `
              <div class="asset-split-links">
                ${item.layers.typography?.transparent_url ? `<a class="asset-link-pill" href="${item.layers.typography.transparent_url}" target="_blank" rel="noreferrer">文字透明 PNG</a>` : ""}
                ${item.layers.typography?.url ? `<a class="asset-link-pill" href="${item.layers.typography.url}" target="_blank" rel="noreferrer">第一步版式图</a>` : ""}
                ${item.layers.scene?.url ? `<a class="asset-link-pill" href="${item.layers.scene.url}" target="_blank" rel="noreferrer">第二步完整 KV</a>` : ""}
                ${item.layers.layout_guide?.url ? `<a class="asset-link-pill" href="${item.layers.layout_guide.url}" target="_blank" rel="noreferrer">空间约束图</a>` : ""}
              </div>
            ` : ""}
            ${item.split ? `
              <div class="asset-split-links">
                ${item.split.title_layer?.transparent_url ? `<a class="asset-link-pill" href="${item.split.title_layer.transparent_url}" target="_blank" rel="noreferrer">标题透明 PNG</a>` : ""}
                ${item.split.title_layer?.url ? `<a class="asset-link-pill" href="${item.split.title_layer.url}" target="_blank" rel="noreferrer">标题原图</a>` : ""}
                ${item.split.background_layer?.url ? `<a class="asset-link-pill" href="${item.split.background_layer.url}" target="_blank" rel="noreferrer">背景图</a>` : ""}
                ${item.split.split_package?.url ? `<a class="asset-link-pill" href="${item.split.split_package.url}" download>拆分包 JSON</a>` : ""}
              </div>
            ` : ""}
            <button class="asset-link-pill" type="button" data-split-asset="${encodeURIComponent(item.name || "")}">
              ${item.split ? "重新 AI 拆分" : "AI 拆分标题/背景"}
            </button>
            <button class="danger-pill" type="button" data-delete-asset="${encodeURIComponent(item.name || "")}">删除</button>
          </div>
          <a class="asset-image" href="${item.url}" target="_blank" rel="noreferrer">
            <img src="${item.url}" alt="${escapeHtml(item.title || item.name || "生成图")}" />
          </a>
        </article>
      `,
    )
    .join("");
  assetsList.querySelectorAll("[data-delete-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const name = decodeURIComponent(button.dataset.deleteAsset || "");
      if (!name || !window.confirm(`确认删除资产 ${name}？`)) return;
      button.disabled = true;
      try {
        const target = ordered.find((item) => item.name === name);
        const payload = await deleteAsset(name);
        writeAssetRecords(readAssetRecords().filter((item) => (
          item.name !== name && (!target?.object_key || item.object_key !== target.object_key)
        )));
        renderAssets(payload.assets || []);
      } catch (error) {
        if (target?.local_only && /未找到该资产|not found/i.test(error.message)) {
          writeAssetRecords(readAssetRecords().filter((item) => (
            item.name !== name && (!target?.object_key || item.object_key !== target.object_key)
          )));
          await loadAssets();
          window.alert(`该资产仅存在于本地缓存，已从本地列表移除：${name}`);
          return;
        }
        button.disabled = false;
        window.alert(error.message);
      }
    });
  });
  assetsList.querySelectorAll("[data-split-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const name = decodeURIComponent(button.dataset.splitAsset || "");
      const item = ordered.find((asset) => asset.name === name);
      if (!item) return;
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = "拆分中...";
      try {
        const splitResult = await splitAsset(item);
        saveAssetSplitResult(item, splitResult);
        const freshAssets = await loadAssets();
        renderAssets(freshAssets);
      } catch (error) {
        button.disabled = false;
        button.textContent = oldText;
        window.alert(error.message);
      }
    });
  });
}

async function loadAssets() {
  return loadProjects();
}

function renderStyleList() {
  const visible = allStylePresets.filter((item) => item.id !== "none");
  styleList.className = "style-card-grid";
  styleList.innerHTML = `
    ${visible
      .map(
        (item) => `
          <article class="style-manage-card">
            ${item.thumbnail ? `<img src="${item.thumbnail}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" />` : `<span>${escapeHtml(styleNameShort(item.name))}</span>`}
            <strong>${escapeHtml(styleNameShort(item.name))}</strong>
          </article>
        `,
      )
      .join("")}
    <button type="button" class="style-manage-card add-style-card" id="addStyleFolderButton">
      <span>+</span>
      <strong>新增风格</strong>
    </button>
  `;
  document.querySelector("#addStyleFolderButton")?.addEventListener("click", () => styleFolderInput.click());
}

async function loadStyles() {
  const response = await fetch("/api/style-presets");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "读取风格失败");
  allStylePresets = payload.presets || [];
  if (!allStylePresets.some((item) => item.id === stylePresetInput.value)) stylePresetInput.value = "none";
  if (!selectedIntegratedLayout()) integratedLayoutInput.value = "";
  renderStylePresetCards();
  renderStyleList();
  syncStylePickerButton();
  return allStylePresets;
}

function readTextFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsText(file, "utf-8");
  });
}

function pathParts(file) {
  return (file.webkitRelativePath || file.name).split("/").filter(Boolean);
}

async function importStyleFolder(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  styleMessage.textContent = "正在解析风格文件夹...";
  const root = pathParts(list[0])[0] || "新风格";
  const images = list.filter((file) => /^image\//.test(file.type));
  const texts = list.filter((file) => /\.(txt|md)$/i.test(file.name));
  if (!images.length) {
    styleMessage.textContent = "文件夹里至少需要一张图片。";
    return;
  }
  const textBuckets = { font: [], style: [] };
  for (const file of texts) {
    const parts = pathParts(file);
    if (parts.some((part) => part.includes("排版"))) continue;
    const group = parts.some((part) => part.includes("字体"))
      ? "font"
      : "style";
    textBuckets[group].push(await readTextFile(file));
  }
  const sortedImages = images.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "zh-Hans-CN"));
  const styleImage = sortedImages.find((file) => pathParts(file).some((part) => part.includes("风格"))) || sortedImages[0];
  const body = new FormData();
  body.append("name", root);
  body.append("subtitle", "文件夹导入风格");
  body.append("visual_keywords", textBuckets.style.join("\n") || root);
  body.append("composition_rules", "");
  body.append("title_style_features", textBuckets.font.join("\n"));
  body.append("texture_rules", textBuckets.style.join("\n"));
  body.append("scene_expansion_rules", ["画面要有留白，不做过多细碎内容", "严禁增加无关文字信息", "如果提到时间，一定要和标题字体做在一块儿"].join("\n"));
  body.append("thumbnail", styleImage);
  sortedImages.forEach((file, index) => body.append(`reference_image_${index}`, file));
  try {
    const response = await apiFetch("/api/style-presets/add", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "保存失败");
    allStylePresets = payload.style_presets || [];
    stylePresetInput.value = payload.preset?.preset_id || stylePresetInput.value;
    renderStylePresetCards();
    renderStyleList();
    styleMessage.textContent = `已保存 ${payload.preset?.name || root}`;
  } catch (error) {
    styleMessage.textContent = error.message;
  } finally {
    styleFolderInput.value = "";
  }
}

function inspirationProxyUrl(url) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function loadInspirationImage(image, directUrl, fallbackElement) {
  image.dataset.proxyAttempted = "false";
  image.classList.remove("hidden");
  fallbackElement?.classList.add("hidden");
  image.onload = () => {
    image.classList.remove("hidden");
    fallbackElement?.classList.add("hidden");
  };
  image.onerror = () => {
    if (image.dataset.proxyAttempted !== "true") {
      image.dataset.proxyAttempted = "true";
      image.src = inspirationProxyUrl(directUrl);
      return;
    }
    image.classList.add("hidden");
    fallbackElement?.classList.remove("hidden");
  };
  image.src = directUrl;
}

function setInspirationMode(active) {
  inspirationSection.classList.toggle("hidden", !active);
  libraryList.classList.toggle("hidden", active);
  materialFilters.classList.toggle("hidden", active);
}

function renderInspirationSkeleton(keyword) {
  inspirationTitle.textContent = `“${keyword}”的设计灵感`;
  inspirationSummary.textContent = "正在扩展中英文设计查询并检索 Pinterest 与 Behance";
  inspirationStatus.className = "inspiration-status loading";
  inspirationStatus.textContent = "搜索中";
  inspirationList.className = "inspiration-masonry inspiration-loading-grid";
  inspirationList.innerHTML = Array.from({ length: 10 }, (_, index) => `
    <div class="inspiration-skeleton" aria-hidden="true">
      <span style="height:${180 + (index % 4) * 34}px"></span>
      <i></i><i></i>
    </div>
  `).join("");
}

function renderInspirationError(message) {
  inspirationSummary.textContent = "搜索未完成";
  inspirationStatus.className = "inspiration-status error";
  inspirationStatus.innerHTML = `
    <div>
      <strong>设计灵感暂时没有加载成功</strong>
      <span>${escapeHtml(message || "设计灵感搜索暂时不可用，请稍后重试。")}</span>
    </div>
    <button type="button" data-retry-inspiration>重试</button>
  `;
  inspirationList.className = "inspiration-masonry";
  inspirationList.innerHTML = "";
  inspirationStatus.querySelector("[data-retry-inspiration]")?.addEventListener("click", () => {
    searchInspiration(lastInspirationKeyword);
  });
}

function renderInspirationEmpty(keyword) {
  inspirationTitle.textContent = `“${keyword}”的设计灵感`;
  inspirationSummary.textContent = "没有找到足够相关的设计案例";
  inspirationStatus.className = "inspiration-status empty";
  inspirationStatus.innerHTML = "<strong>换一个更具体的主题试试，例如“夏日咖啡”或“宠物活动”。</strong>";
  inspirationList.className = "inspiration-masonry";
  inspirationList.innerHTML = "";
}

function renderInspirationResults(payload) {
  inspirationItems = Array.isArray(payload.items) ? payload.items : [];
  if (!inspirationItems.length) {
    renderInspirationEmpty(payload.keyword || lastInspirationKeyword);
    return;
  }
  inspirationTitle.textContent = `“${payload.keyword}”的设计灵感`;
  const sourceCounts = payload.sources || inspirationItems.reduce((counts, item) => {
    const source = inspirationSource(item);
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
  const sourceSummary = [
    sourceCounts.pinterest ? `Pinterest ${sourceCounts.pinterest}` : "",
    sourceCounts.behance ? `Behance ${sourceCounts.behance}` : "",
  ].filter(Boolean).join(" · ");
  inspirationSummary.textContent = `共 ${payload.total} 条${sourceSummary ? ` · ${sourceSummary}` : ""} · ${payload.queries?.length || 0} 组设计查询`;
  inspirationStatus.className = "inspiration-status";
  inspirationStatus.textContent = "";
  inspirationList.className = "inspiration-masonry";
  inspirationList.innerHTML = inspirationItems.map((item) => {
    const saved = Boolean(savedInspirationMaterial(item));
    const source = inspirationSource(item);
    const sourceName = inspirationSourceName(item);
    const sourceUrl = inspirationSourceUrl(item);
    const fallbackTitle = source === "behance" ? "Behance 设计项目" : "Pinterest 设计案例";
    const matchText = [item.author ? `作者：${item.author}` : "", item.query ? `匹配：${item.query}` : ""].filter(Boolean).join(" · ");
    return `
    <article class="inspiration-card" data-inspiration-card="${escapeHtml(item.id)}">
      <button type="button" class="inspiration-card-media" data-inspiration-preview="${escapeHtml(item.id)}" aria-label="预览 ${escapeHtml(item.title)}">
        <img data-inspiration-image="${escapeHtml(item.id)}" loading="lazy" alt="${escapeHtml(item.title)}" />
        <span class="inspiration-image-fallback hidden">图片暂时无法加载</span>
      </button>
      <div class="inspiration-card-copy">
        <strong>${escapeHtml(item.title || fallbackTitle)}</strong>
        <div class="inspiration-labels">
          <span>${escapeHtml(item.designType || "视觉设计")}</span>
          <span class="source-badge ${escapeHtml(source)}-source">${sourceName}</span>
        </div>
        <p title="${escapeHtml(matchText)}">${escapeHtml(matchText)}</p>
        <div class="inspiration-card-actions">
          <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${source === "behance" ? "原项目" : "原 Pin"}</a>
          <button type="button" data-save-inspiration="${escapeHtml(item.id)}" class="${saved ? "saved" : ""}">${saved ? "已保存" : "保存到素材库"}</button>
        </div>
      </div>
    </article>
  `;
  }).join("");

  inspirationList.querySelectorAll("[data-inspiration-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      openInspirationPreview(inspirationItems.find((item) => String(item.id) === button.dataset.inspirationPreview));
    });
  });
  inspirationList.querySelectorAll("[data-save-inspiration]").forEach((button) => {
    button.addEventListener("click", () => {
      openInspirationPreview(inspirationItems.find((item) => String(item.id) === button.dataset.saveInspiration));
    });
  });
  inspirationList.querySelectorAll("[data-inspiration-image]").forEach((image) => {
    const item = inspirationItems.find((candidate) => String(candidate.id) === image.dataset.inspirationImage);
    if (item) loadInspirationImage(image, item.thumbnailUrl || item.imageUrl, image.nextElementSibling);
  });
}

async function searchInspiration(keyword) {
  const normalizedKeyword = String(keyword || inspirationSearchInput.value).replace(/\s+/g, " ").trim();
  if (!normalizedKeyword) {
    clearInspirationSearch();
    return;
  }
  const requestId = ++inspirationRequestSerial;
  lastInspirationKeyword = normalizedKeyword;
  inspirationSearchInput.value = normalizedKeyword;
  inspirationSearchButton.disabled = true;
  libraryMessage.textContent = "";
  setInspirationMode(true);
  renderInspirationSkeleton(normalizedKeyword);

  try {
    const response = await apiFetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: normalizedKeyword, limit: 40 }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "设计灵感搜索失败");
    if (requestId !== inspirationRequestSerial) return;
    renderInspirationResults(payload);
  } catch (error) {
    if (requestId !== inspirationRequestSerial) return;
    inspirationItems = [];
    renderInspirationError(error.message);
  } finally {
    if (requestId === inspirationRequestSerial) inspirationSearchButton.disabled = false;
  }
}

function clearInspirationSearch(resetInput = true) {
  inspirationRequestSerial += 1;
  inspirationItems = [];
  activeInspiration = null;
  lastInspirationKeyword = "";
  if (resetInput) inspirationSearchInput.value = "";
  inspirationSearchButton.disabled = false;
  inspirationStatus.textContent = "";
  inspirationList.innerHTML = "";
  setInspirationMode(false);
}

function openInspirationPreview(item) {
  if (!item) return;
  activeInspiration = item;
  const savedMaterial = savedInspirationMaterial(item);
  const source = inspirationSource(item);
  const sourceName = inspirationSourceName(item);
  const sourceUrl = inspirationSourceUrl(item);
  const fallbackTitle = source === "behance" ? "Behance 设计项目" : "Pinterest 设计案例";
  inspirationPreviewType.textContent = item.designType || "视觉设计";
  inspirationPreviewTitle.textContent = item.title || fallbackTitle;
  inspirationPreviewDescription.textContent = item.description || "该设计案例暂无文字描述。";
  inspirationPreviewSource.textContent = sourceName;
  inspirationPreviewAuthorRow.classList.toggle("hidden", !item.author);
  inspirationPreviewAuthor.textContent = item.author || "";
  inspirationPreviewQuery.textContent = item.query || "-";
  inspirationPreviewDimensions.textContent = item.width && item.height ? `${item.width} × ${item.height}` : "未知";
  inspirationPreviewLink.href = sourceUrl;
  inspirationPreviewLink.textContent = source === "behance" ? "查看 Behance 原项目" : "查看原 Pin";
  inspirationPreviewImage.alt = item.title || fallbackTitle;
  const selectedRoles = savedMaterial ? materialRoles(savedMaterial) : ["完整案例"];
  inspirationRoleInputs.forEach((input) => {
    input.checked = selectedRoles.includes(input.value);
  });
  inspirationSaveTags.value = savedMaterial?.industry_tags?.length
    ? savedMaterial.industry_tags.join("、")
    : uniqueTextList([lastInspirationKeyword || item.query]).join("、");
  inspirationSaveMessage.textContent = savedMaterial ? "该图片已保存，可继续更新参考用途。" : "";
  inspirationSaveMessage.classList.toggle("success", Boolean(savedMaterial));
  inspirationSaveButton.textContent = savedMaterial ? "更新分类" : "保存到素材库";
  inspirationSaveButton.disabled = false;
  loadInspirationImage(inspirationPreviewImage, item.imageUrl, inspirationPreviewFallback);
  inspirationPreviewModal.classList.remove("hidden");
}

function closeInspirationPreview() {
  inspirationPreviewModal.classList.add("hidden");
  inspirationPreviewImage.onload = null;
  inspirationPreviewImage.onerror = null;
  inspirationPreviewImage.removeAttribute("src");
  inspirationPreviewFallback.classList.add("hidden");
  inspirationSaveMessage.textContent = "";
  inspirationSaveMessage.classList.remove("success");
  activeInspiration = null;
}

function refreshInspirationSaveButtons() {
  inspirationList.querySelectorAll("[data-save-inspiration]").forEach((button) => {
    const item = inspirationItems.find((candidate) => String(candidate.id) === button.dataset.saveInspiration);
    const saved = Boolean(savedInspirationMaterial(item));
    button.textContent = saved ? "已保存" : "保存到素材库";
    button.classList.toggle("saved", saved);
  });
}

async function saveActiveInspiration() {
  if (!activeInspiration) return;
  const referenceRoles = inspirationRoleInputs.filter((input) => input.checked).map((input) => input.value);
  if (!referenceRoles.length) {
    inspirationSaveMessage.textContent = "请至少选择一个参考用途。";
    inspirationSaveMessage.classList.remove("success");
    return;
  }

  inspirationSaveButton.disabled = true;
  inspirationSaveButton.textContent = "保存中...";
  inspirationSaveMessage.textContent = "正在下载原图并保存到本地素材库";
  inspirationSaveMessage.classList.remove("success");
  try {
    const item = activeInspiration;
    const response = await apiFetch("/api/materials/save-inspiration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...item,
        reference_roles: referenceRoles,
        industry_tags: uniqueTextList(inspirationSaveTags.value),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "保存到素材库失败");
    allMaterials = payload.materials || allMaterials;
    renderMaterialFilterOptions();
    renderLibrary();
    refreshInspirationSaveButtons();
    inspirationSaveMessage.textContent = payload.duplicate ? "参考用途已更新，图片无需重复下载。" : "已保存到素材库，可直接用作参考图。";
    inspirationSaveMessage.classList.add("success");
    inspirationSaveButton.textContent = "更新分类";
  } catch (error) {
    inspirationSaveMessage.textContent = error.message;
    inspirationSaveMessage.classList.remove("success");
    inspirationSaveButton.textContent = "重试保存";
  } finally {
    inspirationSaveButton.disabled = false;
  }
}

function renderMaterialFilterOptions() {
  const selected = materialDesignTypeFilter.value || "全部";
  const options = [...new Set(allMaterials.map((item) => String(item.design_type || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  materialDesignTypeFilter.innerHTML = ["全部", ...options]
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
  materialDesignTypeFilter.value = options.includes(selected) ? selected : "全部";
}

function renderLibrary(items = allMaterials) {
  const selectedDesignType = materialDesignTypeFilter.value || "全部";
  const selectedSource = materialSourceFilter.value || "全部";
  const selectedOrientation = materialOrientationFilter.value || "全部";
  const visible = items.filter((item) => {
    if (activeMaterialTab !== "全部" && !materialRoles(item).includes(activeMaterialTab)) return false;
    if (selectedDesignType !== "全部" && item.design_type !== selectedDesignType) return false;
    if (selectedSource !== "全部" && (item.source || "local") !== selectedSource) return false;
    if (selectedOrientation !== "全部" && materialOrientation(item) !== selectedOrientation) return false;
    return true;
  });
  if (!visible.length) {
    libraryList.className = "material-masonry empty-state";
    libraryList.textContent = activeMaterialTab === "全部" ? "当前筛选下暂无素材" : `暂无${activeMaterialTab}素材`;
    return;
  }
  libraryList.className = "material-masonry";
  libraryList.innerHTML = visible
    .map(
      (item) => `
        <button type="button" class="material-thumb" data-material-number="${escapeHtml(item.number)}">
          <img src="${item.image || ""}" alt="${escapeHtml(item.number)}" loading="lazy" decoding="async" />
        </button>
      `,
    )
    .join("");
  libraryList.querySelectorAll("[data-material-number]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMaterial = allMaterials.find((item) => item.number === button.dataset.materialNumber);
      openMaterialDetail(activeMaterial);
    });
  });
}

async function loadLibrary() {
  const response = await fetch("/api/materials");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "读取素材库失败");
  allMaterials = payload.materials || [];
  renderMaterialFilterOptions();
  renderLibrary();
  return allMaterials;
}

async function deleteMaterial(number) {
  const response = await apiFetch(`/api/materials/${encodeURIComponent(number)}`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;
  const fallback = await apiFetch("/api/materials/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number }),
  });
  const fallbackPayload = await fallback.json().catch(() => ({}));
  if (!fallback.ok) throw new Error(fallbackPayload.error || payload.error || "删除失败，请确认服务已重启");
  return fallbackPayload;
}

function openMaterialDetail(item) {
  if (!item) return;
  materialDetailImage.src = item.image || "";
  materialDetailImage.alt = item.number || "";
  materialDetailType.textContent = materialRoles(item).join(" · ") || item.type || "素材";
  const categoryParts = [item.design_type, ...uniqueTextList(item.industry_tags), item.category].filter(Boolean);
  materialDetailCategory.textContent = [...new Set(categoryParts)].join(" · ") || "未填写分类";
  materialDetailDescription.textContent = materialDescription(item) || "未填写详细描述";
  materialDetailSource.classList.toggle("hidden", !item.source_url);
  materialDetailSource.href = item.source_url || "#";
  materialDetailSource.textContent = item.source === "behance"
    ? "查看 Behance 原项目"
    : item.source === "pinterest"
      ? "查看原 Pin"
      : "查看原来源";
  materialDetailModal.classList.remove("hidden");
}

function closeMaterialDetail() {
  materialDetailModal.classList.add("hidden");
  materialDetailSource.classList.add("hidden");
  materialDetailSource.href = "#";
  materialDetailSource.textContent = "查看原来源";
  activeMaterial = null;
}

async function boot() {
  try {
    renderSizePicker();
    runButton.classList.toggle("active", visualDescriptionInput.value.trim().length > 0);
    const results = await Promise.allSettled([
      loadStyles(),
      loadRecentProjects(),
      loadHomeInspiration(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  } catch (error) {
    setError(`服务异常：${error.message}`);
  }
}

function projectUpdatedLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `更新于 ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

async function fetchProjects() {
  const response = await fetch("/api/projects");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "读取项目失败");
  return payload.projects || [];
}

function projectCardHtml(project) {
  const title = project.title || "Untitled";
  const cover = project.thumbnail_url
    ? `<img src="${escapeHtml(project.thumbnail_url)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" />`
    : "";
  return `<article class="project-card" data-project-id="${escapeHtml(project.id)}" data-project-title="${escapeHtml(title)}">
    <div class="project-card-thumb${project.thumbnail_url ? " is-loading" : " placeholder"}">${cover}</div>
    <div class="project-card-body">
      <div class="project-card-title-row">
        <h3>${escapeHtml(title)}</h3>
        <div class="project-card-actions">
          <button type="button" class="project-menu-trigger" aria-label="项目操作" aria-haspopup="menu" aria-expanded="false">
            <img src="/ui-assets/icon/project-more.png" alt="" />
          </button>
          <div class="project-card-menu hidden" role="menu">
            <button type="button" class="project-menu-item rename" data-project-rename role="menuitem">
              <img src="/ui-assets/icon/project-rename.png" alt="" /><span>重命名</span>
            </button>
            <button type="button" class="project-menu-item delete" data-project-delete role="menuitem">
              <img src="/ui-assets/icon/project-delete.png" alt="" /><span>删除</span>
            </button>
          </div>
        </div>
      </div>
      <p>${projectUpdatedLabel(project.updated_at || project.created_at)}</p>
    </div>
  </article>`;
}

function newProjectCardHtml() {
  return `<div class="project-card project-card-new" data-new-project>
    <div class="project-card-thumb placeholder"><span>＋</span></div>
    <div class="project-card-body"><h3>新建项目</h3></div>
  </div>`;
}

function projectSkeletonCardHtml() {
  return `<div class="project-card project-card-skeleton" aria-hidden="true">
    <div class="project-skeleton-thumb"></div>
    <div class="project-skeleton-copy">
      <span class="project-skeleton-line title"></span>
      <span class="project-skeleton-line meta"></span>
    </div>
  </div>`;
}

function renderProjectSkeletons(container, { withNewCard = false, count = 5 } = {}) {
  const cards = [
    ...(withNewCard ? [newProjectCardHtml()] : []),
    ...Array.from({ length: Math.max(1, count - (withNewCard ? 1 : 0)) }, projectSkeletonCardHtml),
  ];
  container.classList.remove("empty-state");
  container.setAttribute("aria-busy", "true");
  container.innerHTML = cards.join("");
  bindProjectCardInteractions(container);
}

function closeProjectMenus(except = null) {
  document.querySelectorAll(".project-card-menu:not(.hidden)").forEach((menu) => {
    if (menu === except) return;
    menu.classList.add("hidden");
    const trigger = menu.closest(".project-card-actions")?.querySelector(".project-menu-trigger");
    trigger?.classList.remove("active");
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function closeProjectActionModal() {
  activeProjectAction = null;
  projectActionModal.classList.add("hidden");
  projectActionError.classList.add("hidden");
  projectActionError.textContent = "";
  projectActionConfirm.disabled = false;
}

function openProjectActionModal(mode, project) {
  activeProjectAction = { mode, id: project.id, title: project.title || "Untitled" };
  const deleting = mode === "delete";
  projectActionTitle.textContent = deleting ? "删除项目？" : "重命名项目";
  projectRenameField.classList.toggle("hidden", deleting);
  projectDeleteCopy.classList.toggle("hidden", !deleting);
  projectDeleteCopy.textContent = deleting
    ? `删除后无法恢复，确认删除「${activeProjectAction.title}」吗？`
    : "";
  projectRenameInput.value = deleting ? "" : activeProjectAction.title;
  projectActionConfirm.textContent = deleting ? "删除" : "确定";
  projectActionConfirm.classList.toggle("danger", deleting);
  projectActionError.classList.add("hidden");
  projectActionModal.classList.remove("hidden");
  requestAnimationFrame(() => (deleting ? projectActionConfirm : projectRenameInput).focus());
}

function bindProjectCardInteractions(container) {
  container.querySelector("[data-new-project]")?.addEventListener("click", () => {
    createProject().catch((error) => setError(error.message));
  });
  container.querySelectorAll("[data-project-id]").forEach((card) => {
    const project = { id: card.dataset.projectId, title: card.dataset.projectTitle || "Untitled" };
    const thumb = card.querySelector(".project-card-thumb");
    const image = thumb?.querySelector("img");
    if (image) {
      const finishImageLoading = () => thumb.classList.remove("is-loading");
      if (image.complete) finishImageLoading();
      else {
        image.addEventListener("load", finishImageLoading, { once: true });
        image.addEventListener("error", finishImageLoading, { once: true });
      }
    }
    card.addEventListener("click", (event) => {
      if (event.target.closest(".project-card-actions")) return;
      openCanvas(card.dataset.projectId).catch((error) => setError(error.message));
    });
    const trigger = card.querySelector(".project-menu-trigger");
    const menu = card.querySelector(".project-card-menu");
    trigger?.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = menu.classList.contains("hidden");
      closeProjectMenus(opening ? menu : null);
      menu.classList.toggle("hidden", !opening);
      trigger.classList.toggle("active", opening);
      trigger.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    card.querySelector("[data-project-rename]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeProjectMenus();
      openProjectActionModal("rename", project);
    });
    card.querySelector("[data-project-delete]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeProjectMenus();
      openProjectActionModal("delete", project);
    });
  });
}

function renderProjectsInto(container, projects, { withNewCard = false, limit = 0 } = {}) {
  const list = limit > 0 ? projects.slice(0, limit) : projects;
  const cards = [...(withNewCard ? [newProjectCardHtml()] : []), ...list.map(projectCardHtml)];
  container.classList.remove("empty-state");
  container.removeAttribute("aria-busy");
  container.innerHTML = cards.length ? cards.join("") : `<div class="empty-state">暂无项目，去生成第一张吧</div>`;
  bindProjectCardInteractions(container);
}

async function loadProjects() {
  renderProjectSkeletons(projectsGrid, { withNewCard: true, count: 10 });
  const projects = await fetchProjects();
  renderProjectsInto(projectsGrid, projects, { withNewCard: true });
  return projects;
}

async function loadRecentProjects() {
  renderProjectSkeletons(recentProjects, { withNewCard: true, count: 5 });
  const projects = await fetchProjects().catch(() => []);
  renderProjectsInto(recentProjects, projects, { withNewCard: true, limit: 4 });
}

async function refreshProjectCards() {
  const projects = await fetchProjects();
  renderProjectsInto(recentProjects, projects, { withNewCard: true, limit: 4 });
  renderProjectsInto(projectsGrid, projects, { withNewCard: true });
}

let homeMaterialTab = "全部";

function homeMaterialsForTab(materials) {
  if (homeMaterialTab === "全部") return materials;
  return materials.filter((material) => {
    const roles = [material.type, material.reference_type, ...(material.reference_roles || [])].map(String);
    return roles.some((role) => role.includes(homeMaterialTab.slice(0, 2)));
  });
}

function renderHomeInspirationSkeletons() {
  const heights = [178, 244, 204, 266, 188, 232, 196, 254, 216, 184];
  homeInspiration.classList.remove("empty-state");
  homeInspiration.setAttribute("aria-busy", "true");
  homeInspiration.innerHTML = heights.map((height) => (
    `<div class="material-skeleton-card" style="--skeleton-height:${height}px" aria-hidden="true"></div>`
  )).join("");
}

function bindHomeInspirationImages(container) {
  container.querySelectorAll(".material-thumb.is-loading").forEach((button) => {
    const image = button.querySelector("img");
    const finish = () => button.classList.remove("is-loading");
    if (!image || image.complete) finish();
    else {
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    }
  });
}

async function loadHomeInspiration() {
  renderHomeInspirationSkeletons();
  const role = homeMaterialTab === "全部" ? "" : homeMaterialTab;
  const params = new URLSearchParams({ limit: "10" });
  if (role) params.set("role", role);
  const payload = await fetch(`/api/materials?${params}`).then((response) => response.json()).catch(() => ({ materials: [] }));
  const list = homeMaterialsForTab(payload.materials || []).slice(0, 10);
  homeInspiration.classList.remove("empty-state");
  homeInspiration.removeAttribute("aria-busy");
  homeInspiration.innerHTML = list.length
    ? list.map((material) => `
        <button type="button" class="material-thumb is-loading" data-material-number="${escapeHtml(material.number || "")}">
          <img src="${escapeHtml(material.image || "")}" alt="" loading="lazy" decoding="async" />
        </button>`).join("")
    : `<div class="empty-state">暂无灵感素材</div>`;
  bindHomeInspirationImages(homeInspiration);
  homeInspiration.querySelectorAll("[data-material-number]").forEach((button) => {
    button.addEventListener("click", () => {
      const material = (payload.materials || []).find((item) => item.number === button.dataset.materialNumber);
      if (material) {
        activeMaterial = material;
        openMaterialDetail(material);
      }
    });
  });
}

homeInspirationTabs?.querySelectorAll("[data-home-material-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    homeMaterialTab = button.dataset.homeMaterialTab || "全部";
    homeInspirationTabs.querySelectorAll("[data-home-material-tab]").forEach((node) => node.classList.toggle("active", node === button));
    loadHomeInspiration().catch(() => {});
  });
});

async function createProject() {
  const response = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Untitled" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "创建项目失败");
  await openCanvas(payload.id);
}

function ensureCanvasApp() {
  if (typeof window.__startCanvasSession === "function") return Promise.resolve();
  if (canvasAppLoadPromise) return canvasAppLoadPromise;
  canvasAppLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/canvas-app.js";
    script.async = true;
    script.onload = () => {
      const startedAt = performance.now();
      const waitForCanvasSession = () => {
        if (typeof window.__startCanvasSession === "function") {
          resolve();
          return;
        }
        if (performance.now() - startedAt > 5000) {
          reject(new Error("画布模块初始化失败"));
          return;
        }
        window.setTimeout(waitForCanvasSession, 16);
      };
      waitForCanvasSession();
    };
    script.onerror = () => reject(new Error("画布模块加载失败，请稍后重试"));
    document.body.appendChild(script);
  }).catch((error) => {
    canvasAppLoadPromise = null;
    throw error;
  });
  return canvasAppLoadPromise;
}

async function openCanvas(projectId, init = null) {
  const [response] = await Promise.all([
    fetch(`/api/projects/${encodeURIComponent(projectId)}`),
    ensureCanvasApp(),
  ]);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "读取项目失败");
  showView("canvas");
  window.__startCanvasSession(init ? { ...init, projectId, project: payload } : { projectId, project: payload });
}

window.__canvasTool = (action, event) => {
  if (action === "upload") {
    uploadTrigger.click();
  } else if (action === "style") {
    stylePickerButton.click();
  } else if (action === "size") {
    const anchor = event?.currentTarget || sizePickerButton;
    const rect = anchor.getBoundingClientRect();
    sizePopover.style.left = `${Math.max(8, rect.left)}px`;
    sizePopover.style.top = `${Math.max(8, rect.top - sizePopover.offsetHeight - 8)}px`;
    sizePopover.style.position = "fixed";
    sizePickerButton.click();
  } else if (action === "expand") {
    if (window.__canvasPromptValue && window.__canvasPromptValue.trim()) {
      visualDescriptionInput.value = window.__canvasPromptValue.trim();
    }
    expandDescriptionButton.click();
  } else if (action === "logo" || action === "search") {
    const button = action === "logo" ? includeLogoButton : includeSearchOverlayButton;
    const enabled = !isToolToggleEnabled(button);
    setToolToggleEnabled(button, enabled);
    window.dispatchEvent(new CustomEvent("refra:canvas-settings", { detail: window.__getCanvasSettings?.() || {} }));
    return enabled;
  }
  return undefined;
};

window.__getCanvasSettings = () => ({
  campaign_name: campaignNameInput.value.trim(),
  campaign_subtitle: campaignSubtitleInput.value.trim(),
  campaign_time: campaignTimeInput.value.trim(),
  image_size: imageSizeInput.value,
  style_preset: stylePresetInput.value,
  integrated_layout_variant: integratedLayoutInput.value,
  doudou_ip: /兜兜/.test(String(window.__canvasPromptValue || visualDescriptionInput.value)),
  include_logo: isToolToggleEnabled(includeLogoButton),
  include_search_overlay: isToolToggleEnabled(includeSearchOverlayButton),
  style_name: stylePickerLabel.textContent || "风格预设",
});

window.__applyCanvasSettings = (settings = {}) => {
  if (settings.image_size) setImageSize(settings.image_size);
  if (settings.style_preset) {
    stylePresetInput.value = settings.style_preset;
    integratedLayoutInput.value = settings.integrated_layout_variant || "";
    syncStylePickerButton();
  }
  if (typeof settings.doudou_ip === "boolean") {
    doudouIpInput.value = settings.doudou_ip ? "true" : "false";
    setToolToggleEnabled(doudouIpButton, settings.doudou_ip);
  }
  if (typeof settings.include_logo === "boolean") setToolToggleEnabled(includeLogoButton, settings.include_logo);
  if (typeof settings.include_search_overlay === "boolean") setToolToggleEnabled(includeSearchOverlayButton, settings.include_search_overlay);
};

window.__getReferenceFiles = () => referenceFiles.map((item) => item.file);
window.__getReferencePreviews = canvasReferencePreviews;
window.__removeReferenceFile = removeReferenceFile;
window.__setCanvasImageSize = setImageSize;

window.__canvasReturnedHome = () => {
  showView("generate");
  loadRecentProjects().catch(() => {});
  loadHomeInspiration().catch(() => {});
};

window.__saveCanvasRequested = null;
window.__requestCanvasSave = () => {
  if (window.__saveCanvasRequested) window.__saveCanvasRequested();
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  const prompt = visualDescriptionInput.value.trim();
  if (!prompt) {
    setError("先输入一句画面描述");
    visualDescriptionInput.focus();
    return;
  }
  const init = {
    campaign_name: campaignNameInput.value.trim(),
    campaign_subtitle: campaignSubtitleInput.value.trim(),
    campaign_time: campaignTimeInput.value.trim(),
    visual_description: prompt,
    image_size: imageSizeInput.value,
    style_preset: stylePresetInput.value,
    integrated_layout_variant: integratedLayoutInput.value,
    doudou_ip: /兜兜/.test(prompt),
    include_logo: isToolToggleEnabled(includeLogoButton),
    include_search_overlay: isToolToggleEnabled(includeSearchOverlayButton),
    files: referenceFiles.map((item) => item.file),
    autoGenerate: true,
  };
  const response = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, title: campaignNameInput.value.trim() || "Untitled" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "创建项目失败");
  await openCanvas(payload.id, init);
});

uploadTrigger.addEventListener("click", () => referenceImageInput.click());
referenceImageInput.addEventListener("change", () => addReferenceFiles(referenceImageInput.files || []));
visualDescriptionInput.addEventListener("input", renderMentionMenu);
visualDescriptionInput.addEventListener("input", autoResizeDescription);
visualDescriptionInput.addEventListener("click", renderMentionMenu);
visualDescriptionInput.addEventListener("keyup", renderMentionMenu);
visualDescriptionInput.addEventListener("input", () => {
  runButton.classList.toggle("active", visualDescriptionInput.value.trim().length > 0);
});
expandDescriptionButton.addEventListener("click", expandDescription);
doudouIpButton.addEventListener("click", () => setDoudouIpEnabled(doudouIpInput.value !== "true"));
includeLogoButton.addEventListener("click", () => {
  setToolToggleEnabled(includeLogoButton, !isToolToggleEnabled(includeLogoButton));
});
includeSearchOverlayButton.addEventListener("click", () => {
  setToolToggleEnabled(includeSearchOverlayButton, !isToolToggleEnabled(includeSearchOverlayButton));
});

stylePickerButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (stylePresetSection.classList.contains("hidden")) openStylePresetModal();
  else closeStylePresetModal();
  sizePopover.classList.add("hidden");
});

sizePickerButton.addEventListener("click", (event) => {
  event.stopPropagation();
  sizePopover.classList.toggle("hidden");
  stylePresetSection.classList.add("hidden");
});

document.addEventListener("click", (event) => {
  if (!mentionMenu.contains(event.target) && event.target !== visualDescriptionInput) mentionMenu.classList.add("hidden");
  if (!sizePopover.contains(event.target) && !sizePickerButton.contains(event.target)) sizePopover.classList.add("hidden");
});

stylePresetSection.addEventListener("click", (event) => {
  if (event.target === stylePresetSection) closeStylePresetModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !stylePresetSection.classList.contains("hidden")) closeStylePresetModal();
});

generateButton.addEventListener("click", () => {
  showView("generate");
  loadRecentProjects().catch(() => {});
  loadHomeInspiration().catch(() => {});
});

document.querySelector(".neo-topbar .neo-brand")?.addEventListener("click", () => {
  if (document.querySelector("#canvasPage")?.classList.contains("active")) {
    if (window.__requestCanvasSave) window.__requestCanvasSave();
  }
  showView("generate");
  loadRecentProjects().catch(() => {});
  loadHomeInspiration().catch(() => {});
});
assetsButton.addEventListener("click", () => {
  showView("assets");
  loadAssets().catch((error) => {
    projectsGrid.className = "project-grid empty-state";
    projectsGrid.textContent = error.message;
  });
});
styleButton.addEventListener("click", () => {
  showView("styles");
  loadStyles().catch((error) => {
    styleMessage.textContent = error.message;
  });
});
libraryButton.addEventListener("click", () => {
  showView("materials");
  loadLibrary().catch((error) => {
    libraryMessage.textContent = error.message;
  });
});

recentProjectsMore.addEventListener("click", () => {
  showView("assets");
  loadAssets().catch((error) => setError(error.message));
});

homeInspirationMore.addEventListener("click", () => {
  showView("materials");
  loadLibrary().catch((error) => setError(error.message));
});

let inviteTokenValue = "";
let inviteTokenVisible = false;

function maskAdminToken(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 4) return "*".repeat(text.length);
  if (text.length < 12) return `${text.slice(0, 2)}${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-2)}`;
  return `${text.slice(0, 8)}${"*".repeat(Math.max(4, text.length - 12))}${text.slice(-4)}`;
}

function renderInviteToken() {
  inviteTokenDisplay.textContent = inviteTokenValue
    ? (inviteTokenVisible ? maskAdminToken(inviteTokenValue) : "•".repeat(32))
    : "";
  inviteTokenDisplay.classList.toggle("fully-masked", Boolean(inviteTokenValue && !inviteTokenVisible));
  inviteFieldHasValue();
}

function inviteFieldHasValue() {
  const hasValue = Boolean(inviteTokenValue.trim());
  inviteTokenInput.closest(".invite-field")?.classList.toggle("has-value", hasValue);
  inviteConfirmButton.disabled = !hasValue;
}

function openInviteModal() {
  inviteTokenValue = adminToken();
  inviteTokenVisible = false;
  inviteTokenInput.value = "";
  inviteEyeIcon.src = "/ui-assets/icon/show.png";
  inviteError.classList.add("hidden");
  renderInviteToken();
  inviteModal.classList.remove("hidden");
  requestAnimationFrame(() => inviteTokenInput.focus());
}

window.__openInviteModal = openInviteModal;
inviteButton.addEventListener("click", openInviteModal);

document.querySelectorAll("[data-close-invite]").forEach((el) => {
  el.addEventListener("click", () => inviteModal.classList.add("hidden"));
});

inviteEyeButton.addEventListener("click", () => {
  inviteTokenVisible = !inviteTokenVisible;
  inviteEyeIcon.src = inviteTokenVisible ? "/ui-assets/icon/hide.png" : "/ui-assets/icon/show.png";
  renderInviteToken();
  inviteTokenInput.focus();
});

inviteTokenInput.addEventListener("input", () => {
  inviteTokenValue = inviteTokenInput.value;
  renderInviteToken();
  inviteError.classList.add("hidden");
});

async function validateAdminToken(token) {
  try {
    const response = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

inviteConfirmButton.addEventListener("click", async () => {
  const token = inviteTokenValue.trim();
  if (!token) {
    inviteError.textContent = "请输入 ADMIN_TOKEN";
    inviteError.classList.remove("hidden");
    return;
  }
  inviteConfirmButton.disabled = true;
  const ok = await validateAdminToken(token);
  inviteConfirmButton.disabled = false;
  if (!ok) {
    inviteError.textContent = "ADMIN_TOKEN 输入错误，请重新输入";
    inviteError.classList.remove("hidden");
    return;
  }
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  inviteTokenInput.value = "";
  inviteTokenValue = "";
  inviteModal.classList.add("hidden");
});

inviteTokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !inviteConfirmButton.disabled) inviteConfirmButton.click();
});

projectActionModal.querySelectorAll("[data-close-project-action]").forEach((node) => {
  node.addEventListener("click", closeProjectActionModal);
});
projectActionCancel.addEventListener("click", closeProjectActionModal);
projectRenameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") projectActionConfirm.click();
});
projectActionConfirm.addEventListener("click", async () => {
  if (!activeProjectAction) return;
  const deleting = activeProjectAction.mode === "delete";
  const nextTitle = projectRenameInput.value.trim();
  if (!deleting && !nextTitle) {
    projectActionError.textContent = "请输入项目名称";
    projectActionError.classList.remove("hidden");
    projectRenameInput.focus();
    return;
  }
  projectActionConfirm.disabled = true;
  projectActionError.classList.add("hidden");
  const idleText = deleting ? "删除" : "确定";
  projectActionConfirm.textContent = deleting ? "删除中…" : "保存中…";
  try {
    const options = deleting
      ? { method: "DELETE" }
      : {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        };
    const response = await apiFetch(`/api/projects/${encodeURIComponent(activeProjectAction.id)}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || (deleting ? "删除项目失败" : "重命名失败"));
    closeProjectActionModal();
    await refreshProjectCards();
  } catch (error) {
    projectActionError.textContent = error.message;
    projectActionError.classList.remove("hidden");
  } finally {
    projectActionConfirm.disabled = false;
    if (!projectActionModal.classList.contains("hidden")) projectActionConfirm.textContent = idleText;
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".project-card-actions")) closeProjectMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeProjectMenus();
  if (!projectActionModal.classList.contains("hidden")) closeProjectActionModal();
});

libraryTabs.querySelectorAll("[data-material-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    clearInspirationSearch();
    activeMaterialTab = button.dataset.materialTab || "全部";
    libraryTabs.querySelectorAll("[data-material-tab]").forEach((node) => node.classList.toggle("active", node === button));
    renderLibrary();
  });
});

[materialDesignTypeFilter, materialSourceFilter, materialOrientationFilter].forEach((select) => {
  select.addEventListener("change", renderLibrary);
});
materialFilterReset.addEventListener("click", () => {
  materialDesignTypeFilter.value = "全部";
  materialSourceFilter.value = "全部";
  materialOrientationFilter.value = "全部";
  renderLibrary();
});

inspirationSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchInspiration(inspirationSearchInput.value);
});
inspirationSearchInput.addEventListener("input", () => {
  if (!inspirationSearchInput.value.trim() && !inspirationSection.classList.contains("hidden")) clearInspirationSearch(false);
});
inspirationSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  searchInspiration(inspirationSearchInput.value);
});
inspirationClearButton.addEventListener("click", () => clearInspirationSearch());
inspirationPreviewModal.querySelectorAll("[data-close-inspiration-preview]").forEach((node) => {
  node.addEventListener("click", closeInspirationPreview);
});
inspirationSaveButton.addEventListener("click", saveActiveInspiration);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !inspirationPreviewModal.classList.contains("hidden")) closeInspirationPreview();
});

styleFolderInput.addEventListener("change", () => importStyleFolder(styleFolderInput.files));
materialDetailModal.querySelectorAll("[data-close-material-detail]").forEach((node) => node.addEventListener("click", closeMaterialDetail));
materialUseReferenceButton.addEventListener("click", async () => {
  const item = activeMaterial;
  if (!item) return;
  materialUseReferenceButton.disabled = true;
  materialUseReferenceButton.textContent = "添加中...";
  try {
    const referenceIndex = await addMaterialReference(item);
    closeMaterialDetail();
    openGenerateComposer();
    setError("");
    referenceStrip.querySelector(`[data-remove-reference="${referenceIndex}"]`)?.closest(".reference-chip")?.classList.add("just-added");
  } catch (error) {
    window.alert(error.message);
  } finally {
    materialUseReferenceButton.disabled = false;
    materialUseReferenceButton.textContent = "用作参考图";
  }
});
materialSameButton.addEventListener("click", () => {
  const description = materialDescription(activeMaterial);
  if (!description) {
    window.alert("当前素材还没有详细描述，暂时无法做同款。");
    return;
  }
  visualDescriptionInput.value = description;
  autoResizeDescription();
  closeMaterialDetail();
  openGenerateComposer();
  setError("");
});
materialDeleteButton.addEventListener("click", async () => {
  if (!activeMaterial?.number || !window.confirm(`确认删除素材 ${activeMaterial.number}？`)) return;
  materialDeleteButton.disabled = true;
  try {
    const payload = await deleteMaterial(activeMaterial.number);
    allMaterials = payload.materials || allMaterials.filter((item) => item.number !== activeMaterial.number);
    closeMaterialDetail();
    renderLibrary();
  } catch (error) {
    window.alert(error.message);
  } finally {
    materialDeleteButton.disabled = false;
  }
});

boot();
