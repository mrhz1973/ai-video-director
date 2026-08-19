import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node build-ref-workflow.mjs INPUT_API_JSON OUTPUT_JSON");

const workflow = JSON.parse(await readFile(inputPath, "utf8"));
const entries = () => Object.entries(workflow);
const one = classType => entries().find(([, node]) => node.class_type === classType);
const all = classType => entries().filter(([, node]) => node.class_type === classType);
const nextId = () => String(Math.max(...Object.keys(workflow).map(Number)) + 1);

const [h3Id, h3] = one("MiniMaxH3ReferenceToVideo") || [];
const [, model] = one("UnetLoaderGGUFDynamicVRAM") || [];
if (!h3 || !model) throw new Error("The input is not a MiniMax H3 Ref2V API workflow");

const imageNodes = all("LoadImage").sort(([a], [b]) => Number(a) - Number(b));
if (!imageNodes.length) throw new Error("The workflow needs at least one LoadImage node");
while (imageNodes.length < 7) {
  const id = nextId();
  const clone = structuredClone(imageNodes[0][1]);
  workflow[id] = clone;
  imageNodes.push([id, clone]);
}

for (const key of Object.keys(h3.inputs)) {
  if (/^(ref_images|ref_videos|ref_video_audios|ref_audios)\./.test(key)) delete h3.inputs[key];
}

imageNodes.slice(0, 7).forEach(([id, node], index) => {
  node.inputs.image = `__REFERENCE_IMAGE_${index + 1}__`;
  node._meta = { title: `Reference Image ${index + 1}` };
  h3.inputs[`ref_images.ref_image_${index}`] = [id, 0];
});

const videoId = nextId();
workflow[videoId] = { inputs: { file: "__REFERENCE_VIDEO__" }, class_type: "LoadVideo", _meta: { title: "Motion Reference Video" } };
const videoComponentsId = nextId();
workflow[videoComponentsId] = { inputs: { video: [videoId, 0] }, class_type: "GetVideoComponents", _meta: { title: "Reference Video Components" } };
h3.inputs["ref_videos.ref_video_0"] = [videoComponentsId, 0];

const audioId = nextId();
workflow[audioId] = { inputs: { audio: "__REFERENCE_AUDIO__" }, class_type: "LoadAudio", _meta: { title: "Music and Rhythm Reference" } };
h3.inputs["ref_audios.ref_audio_0"] = [audioId, 0];

h3.inputs.prompt = "__H3_REF2VA_PROMPT__";
h3.inputs.ref_image_size = "match";
model.inputs.unet_name = "minimax-h3-ref2va-Q4_0.gguf";

const save = one("SaveVideo")?.[1];
if (save) save.inputs.filename_prefix = "video/MiniMax_H3_Reference";

await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ h3Id, imageNodeIds: imageNodes.slice(0, 7).map(([id]) => id), videoId, audioId }));
