import test from "node:test";
import assert from "node:assert/strict";
import {
  FREE_IMAGE_SYSTEM_INSTRUCTIONS,
  buildFreeImageResponsesRequest,
  extractFreeImageResponse,
} from "../services/free-image-orchestrator.mjs";

test("无参考图时由 GPT 主模型强制调用一次 generate 图片工具", () => {
  const body = buildFreeImageResponsesRequest({
    prompt: "生成一张自然光下的咖啡海报",
    size: "960x1280",
  });
  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].type, "image_generation");
  assert.equal(body.tools[0].model, "gpt-image-2");
  assert.equal(body.tools[0].action, "generate");
  assert.equal(body.tools[0].quality, "auto");
  assert.equal(body.tools[0].size, "1024x1536");
  assert.equal(body.tool_choice, "required");
  assert.equal(body.max_tool_calls, 1);
  assert.match(body.input[1].content[0].text, /用户原始请求：\n生成一张自然光下的咖啡海报/);
});

test("多参考图保持顺序与 @图N 映射并强制 edit", () => {
  const body = buildFreeImageResponsesRequest({
    prompt: "保持@图1的人物，参考@图2的构图",
    labels: ["图1", "图2"],
    images: [
      { type: "image/jpeg", bytes: Buffer.from("person") },
      { type: "image/png", bytes: Buffer.from("layout") },
    ],
  });
  assert.equal(body.tools[0].action, "edit");
  assert.match(body.input[1].content[0].text, /Image 1 = @图1；Image 2 = @图2/);
  assert.equal(body.input[1].content[1].text, "Image 1 / @图1（第 1 张输入图）");
  assert.match(body.input[1].content[2].image_url, /^data:image\/jpeg;base64,/);
  assert.equal(body.input[1].content[2].detail, "high");
  assert.equal(body.input[1].content[3].text, "Image 2 / @图2（第 2 张输入图）");
  assert.match(body.input[1].content[4].image_url, /^data:image\/png;base64,/);
});

test("编排规则锁定人物身份且只在用户要求时切换视觉媒介", () => {
  assert.match(FREE_IMAGE_SYSTEM_INSTRUCTIONS, /锁定脸型、五官结构与比例间距/);
  assert.match(FREE_IMAGE_SYSTEM_INSTRUCTIONS, /不得换脸/);
  assert.match(FREE_IMAGE_SYSTEM_INSTRUCTIONS, /塑料皮肤、过度磨皮、蜡像感、CG 渲染感/);
  assert.match(FREE_IMAGE_SYSTEM_INSTRUCTIONS, /只有用户明确要求插画、3D、卡通、黏土/);
  assert.match(FREE_IMAGE_SYSTEM_INSTRUCTIONS, /不要把不同图片的人物、产品或风格身份混在一起/);
});

test("提取最终图片和 GPT 自动修订后的真实执行 Prompt", () => {
  const result = extractFreeImageResponse({
    id: "resp_test",
    output: [{
      id: "ig_test",
      type: "image_generation_call",
      revised_prompt: "保持人物身份并使用自然摄影质感",
      result: "ZmFrZS1wbmc=",
    }],
  });
  assert.deepEqual(result, {
    b64: "ZmFrZS1wbmc=",
    revisedPrompt: "保持人物身份并使用自然摄影质感",
    responseId: "resp_test",
    imageCallId: "ig_test",
  });
  assert.throws(() => extractFreeImageResponse({ output: [] }), /没有返回图片生成结果/);
});
