import test from "node:test";import assert from "node:assert/strict";import {cloneAndBind,dimensions,resolutionSettings,collectOutputs} from "../lib/workflow.mjs";
test("binds without mutating source",()=>{const w={"1":{inputs:{text:"old"},class_type:"X"}};const x=cloneAndBind(w,{prompt:{node:"1",input:"text"}},{prompt:"new"});assert.equal(x["1"].inputs.text,"new");assert.equal(w["1"].inputs.text,"old")});
test("rejects stale binding",()=>assert.throws(()=>cloneAndBind({}, {prompt:{node:"9",input:"text"}}, {prompt:"x"}),/missing/));
test("dimensions are multiples of 32",()=>{for(const n of dimensions("16:9","Final"))assert.equal(n%32,0)});
test("maps UI resolution to ComfyUI ResolutionSelector",()=>{assert.deepEqual(resolutionSettings("9:16","Preview"),{aspectRatio:"9:16 (Portrait Widescreen)",megapixels:0.3});assert.equal(resolutionSettings("16:9","Final").megapixels,0.4)});
test("collects view urls",()=>{const x=collectOutputs({outputs:{"1":{images:[{filename:"x.png",subfolder:"",type:"output"}]}}},"http://h");assert.match(x[0].url,/api\/view/)});
