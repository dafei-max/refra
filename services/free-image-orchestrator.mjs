const FREE_IMAGE_SYSTEM_INSTRUCTIONS = `你是对话式图片生成编排器。你的唯一任务是准确理解用户原始请求和按顺序提供的参考图，然后调用一次 image_generation 工具生成一张图。

执行规则：
1. 完整保留用户原始意图，不擅自改换主体、视觉媒介、活动信息或参考图用途；不要输出解释文字。
2. 输入图按顺序对应 Image 1 / @图1、Image 2 / @图2，以此类推。优先执行用户在原始请求中对每张图明确指定的用途；不要把不同图片的人物、产品或风格身份混在一起。
3. 用户将某张图指定为人物主体时，把它视为同一位真人的身份来源：锁定脸型、五官结构与比例间距、眉眼鼻唇、发际线、发型发色、肤色、年龄感、体型与可见识别特征。除非用户明确要求，不得换脸、美化成另一个人或把真人变成 CG、塑料人、游戏角色。
4. 用户将某张图指定为产品主体时，把它视为同一件产品/SKU：锁定品类、轮廓、比例、包装结构、材质、主配色、图形和可见品牌识别特征，不得替换成同类产品或重新设计包装。
5. 用户将图片指定为构图、风格、字体或色彩参考时，只迁移被点名的视觉属性，不复制其中无关人物、产品、文字、Logo、品牌、水印或完整布局。
6. 如果用户没有明确写用途，结合原始请求和图片内容谨慎判断；不得默认把所有图片都当主体，也不得凭空融合不同人物身份。歧义图片仅作为补充视觉参考。
7. 用户要求真人、摄影或参考图本身是真人照片且没有要求改成插画/3D时，生成可信的真实摄影：自然光照和色温、真实皮肤纹理与毛孔、细微瑕疵、真实头发与布料、合理肢体和手部、符合镜头的景深与颗粒；避免塑料皮肤、过度磨皮、蜡像感、CG 渲染感、虚假棚拍光和夸张电影调色。
8. 只有用户明确要求插画、3D、卡通、黏土等非摄影媒介时才采用该媒介，不要一律强制写实。
9. 多图合成时明确每张图贡献什么，并保持人物身份、产品身份、构图与风格职责互不覆盖。只生成一个候选结果。
10. 画面中的可读文字仅使用用户明确提供的内容；不要新增品牌、Logo、价格、日期、口号、水印或乱码。`;

const FREE_IMAGE_PLANNER_INSTRUCTIONS = `${FREE_IMAGE_SYSTEM_INSTRUCTIONS}

当前图片服务与文本服务分离，因此不要调用工具。请把你的理解压缩为一份可直接交给图片模型执行的最终 Prompt：明确每张 Image 的职责、必须保留的身份与产品特征、用户要求的视觉媒介、构图和文字白名单。只输出最终 Prompt，不要解释、标题、Markdown 或备选方案。`;

function cleanLabel(value, index) {
  const fallback = `图${index + 1}`;
  const label = String(value || fallback).trim().replace(/^@/, "");
  return label || fallback;
}

function normalizeImageToolSize(size) {
  const requested = String(size || "").trim();
  if (["1024x1024", "1024x1536", "1536x1024", "auto"].includes(requested)) return requested;
  const [width, height] = requested.split("x").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

function buildUserContent(originalPrompt, images, labels) {
  const mapping = images.length
    ? images.map((_, index) => `Image ${index + 1} = @${cleanLabel(labels[index], index)}`).join("；")
    : "本次没有输入图片。";
  const userContent = [
    {
      type: "input_text",
      text: [
        "请直接生成一张图片，不要先回复方案或解释。",
        `用户原始请求：\n${originalPrompt}`,
        `参考图映射：${mapping}`,
        images.length
          ? "请先在内部理解每张图被指定的职责，再执行生图；生成结果必须遵循上述映射。"
          : "请根据用户原始请求从零生成。",
      ].join("\n\n"),
    },
  ];

  images.forEach((image, index) => {
    const label = cleanLabel(labels[index], index);
    userContent.push(
      { type: "input_text", text: `Image ${index + 1} / @${label}（第 ${index + 1} 张输入图）` },
      {
        type: "input_image",
        image_url: `data:${image.type || "image/png"};base64,${image.bytes.toString("base64")}`,
        detail: "high",
      },
    );
  });
  return userContent;
}

export function buildFreeImageResponsesRequest({
  prompt,
  images = [],
  labels = [],
  size = "1024x1024",
  model = "gpt-5.5",
  imageModel = "gpt-image-2",
}) {
  const originalPrompt = String(prompt || "").trim();
  if (!originalPrompt) throw new Error("自由生图缺少用户原始描述");

  const userContent = buildUserContent(originalPrompt, images, labels);

  return {
    model,
    reasoning: { effort: "low" },
    max_output_tokens: 900,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: FREE_IMAGE_SYSTEM_INSTRUCTIONS }],
      },
      { role: "user", content: userContent },
    ],
    tools: [
      {
        type: "image_generation",
        model: imageModel,
        action: images.length ? "edit" : "generate",
        size: normalizeImageToolSize(size),
        quality: "auto",
        output_format: "png",
      },
    ],
    tool_choice: "required",
    max_tool_calls: 1,
  };
}

export function buildFreeImagePlanningRequest({
  prompt,
  images = [],
  labels = [],
  model = "gpt-5.5",
}) {
  const originalPrompt = String(prompt || "").trim();
  if (!originalPrompt) throw new Error("自由生图缺少用户原始描述");
  return {
    model,
    reasoning: { effort: "low" },
    max_output_tokens: 1_500,
    input: [
      { role: "system", content: [{ type: "input_text", text: FREE_IMAGE_PLANNER_INSTRUCTIONS }] },
      { role: "user", content: buildUserContent(originalPrompt, images, labels) },
    ],
  };
}

export function extractFreeImageResponse(payload = {}) {
  const imageCall = Array.isArray(payload.output)
    ? payload.output.find((item) => item?.type === "image_generation_call" && item.result)
    : null;
  if (!imageCall) {
    const explanation = Array.isArray(payload.output)
      ? payload.output
        .flatMap((item) => item?.content || [])
        .map((item) => item?.text || item?.refusal || "")
        .filter(Boolean)
        .join(" ")
      : "";
    throw new Error(explanation || "OpenAI Responses API 没有返回图片生成结果");
  }
  return {
    b64: imageCall.result,
    revisedPrompt: String(imageCall.revised_prompt || "").trim(),
    responseId: String(payload.id || "").trim(),
    imageCallId: String(imageCall.id || "").trim(),
  };
}

export { FREE_IMAGE_PLANNER_INSTRUCTIONS, FREE_IMAGE_SYSTEM_INSTRUCTIONS };
