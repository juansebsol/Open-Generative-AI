# Submodule backend inventory: Vibe-Workflow, Open-Poe-AI, Open-AI-Design-Agent

Read-only analysis of the submodules at their pinned commits (`git submodule update --init`)
(Vibe-Workflow @ c65ce89, Open-Poe-AI @ 3e21ebc, Open-AI-Design-Agent @ ebc0ce7).
Paths below are relative to each repo root unless prefixed.

---

## TL;DR

* **All three `server/` folders are thin FastAPI + httpx pass-through proxies to `https://api.muapi.ai`.** No database, no
  LLM calls, no DAG engine, no agent loop, no planner, no storage. Total server code: Vibe-Workflow ~415 LOC,
  Open-Poe-AI ~170 LOC, Design-Agent ~310 LOC. Each one only injects `x-api-key: $MU_API_KEY` and forwards.
  `sqlalchemy`/`asyncpg` are listed in two `requirements.txt` files but never imported. Git history shows no earlier
  "real" implementation either.
* So **"self-host the server" buys nothing**: the actual product backends (workflow engine, agent runtime,
  creative-agent planner) are closed-source and live only on muapi.ai. Removing muapi means **building these backends
  from scratch**, against the API contracts the frontend packages expect (documented below).
* The parent app's `app/api/**` routes already reproduce exactly what these Python servers do (proxy + key injection),
  so the Python servers are redundant today.
* Almost none of the frontend calls are "generic model inference". The only one is the agent-icon generator
  (`POST /api/api/v1/flux-schnell-image`). Everything else is a muapi product endpoint
  (workflow CRUD and runs, agent CRUD and chat, creative-agent sessions and jobs) or muapi storage (upload URLs,
  CloudFront signing).
* Every package hard-codes `https://cdn.muapi.ai/` + `fields.key` as the final URL of an upload. **That forces a
  frontend fork** even if we copy the backend contracts exactly.
* Recommendation in short: build a shared provider layer in the parent (LLM via an OpenAI-compatible API, media via
  fal/Replicate/OpenAI/Google adapters, S3-compatible storage, a DB, and a background job runner). Then **rewrite each
  backend inside the parent Next.js app (option b) at the same URL contracts**, and fork the three packages for small
  patches. Effort: Workflow **L**, Agents **M–L**, Design Agent **L–XL**, or drop/defer the design agent (c).

---

## 1. Endpoints each frontend package calls

Conventions: "upstream" is the muapi path the submodule server (and the parent proxy) forwards to. Response shapes
are inferred from how the frontend reads them.

### 1a. Vibe-Workflow: `packages/workflow-builder` (all calls use axios, relative URLs)

| # | Method | Frontend path → muapi upstream | Payload | Expected response | Refs (packages/workflow-builder/src/components/…) |
|---|---|---|---|---|---|
| W1 | GET | `/api/workflow/{wfId}/node-schemas` → `/workflow/{id}/node-schemas` | – | `{categories:{text\|image\|video\|audio\|api\|utility:{models:{[modelId]:{input_schema:{schemas:{input_data:{properties,required}}}, …}}}}}` | NodeFlow.jsx:314 (skipped when the `initialNodeSchemas` prop is given; the parent passes it, WorkflowStudio.jsx:840) |
| W2 | GET | `/api/workflow/get-workflow-def/{id}` → same | – | `{workflow_id,name,category,run_id,is_owner,is_published,is_template,show_temp_button,data:{nodes:[{id,category,model,input_params,output_params:{resultUrl,outputs},position}]},edges:[…],run_history:{[nodeId]:[{status,started_at,node_run_id,result:{id,outputs:[{value}]}}]}}` | NodeFlow.jsx:419, restore 352-411, 162-220 |
| W3 | POST | `/api/workflow/create` → same | `{workflow_id\|null, source_workflow_id\|null, name, edges, data:{nodes:[{id,category,model,input_params,output_params,params,position,inputs?}]}, is_vadoo:false, category}`. The `input_params` hold **template refs** like `{{ text1.outputs[0].value }}` that the server must resolve | `{workflow_id}` | NodeFlow.jsx:1067-1303 (build), 1311 (save), 1333 (duplicate) |
| W4 | POST | `/api/workflow/{wfId}/run` → same | `{cost}` | `{run_id}` | NodeFlow.jsx:1492 |
| W5 | GET | `/api/workflow/run/{runId}/status` → same | – | `{nodes:{[nodeId]:[{status:"processing"\|"running"\|"succeeded"\|"completed"\|"failed", started_at, node_run_id, result:{id,outputs:[{value}]}}]}}`, polled every 3s | NodeFlow.jsx:1360; ImageNode.jsx:197; TextNode.jsx:196; VideoNode.jsx:213; AudioNode.jsx:201; VideoCombiner.jsx:188; ApiNode.jsx:337 |
| W6 | POST | `/api/workflow/{wfId}/node/{nodeId}/run` → same | `{run_id, model, params, cost, node_id:"AI Image"\|"AI Text"\|"Video Combiner"\|"API Node"…}` | `{run_id}` | ImageNode.jsx:277; TextNode.jsx:278; VideoNode.jsx:293; AudioNode.jsx:282; VideoCombiner.jsx:267; ApiNode.jsx:428 |
| W7 | DELETE | `/api/workflow/node-run/{nodeRunId}` → same | – | any | ImageNode.jsx:380; TextNode.jsx:385; VideoNode.jsx:406; AudioNode.jsx:368; VideoCombiner.jsx:348; ApiNode.jsx:531 |
| W8 | GET | `/api/workflow/{wfId}/api-node-schemas` → same | – | `{api_node_schemas:{[nodeId]:{schema:{input_schema}}}}` | ApiNode.jsx:138 |
| W9 | POST | `/api/workflow/architect` → same | `{prompt, workflow_id, history:[{role,content}]}` | `{request_id,status}` | NodeFlow.jsx:967 |
| W10 | GET | `/api/workflow/poll-architect/{reqId}/result` → same | – | `{status:"completed"\|"failed"\|…, message, suggestions[], workflow:{nodes:[{id,category,model,input_params\|params,position}],edges}}`, polled every 3s | NodeFlow.jsx:823-944 |
| W11 | POST | `/api/workflow/workflow/{id}/publish` → same | `{publish:bool}` | `{publish}` | NodeFlow.jsx:1519 |
| W12 | POST | `/api/workflow/workflow/{id}/template` → same | `{is_template:bool}` | `{is_template}` | NodeFlow.jsx:1543 |
| W13 | POST | `/api/workflow/update-category/{id}` → same | `{category}` | any | NodeFlow.jsx:1568 |
| W14 | POST | `/api/workflow/{id}/thumbnail` → same | `{thumbnail:url}` | `{success}` | ImageNode.jsx:451 |
| W15 | POST | `/api/workflow/cloudfront-signed-url` → same | `{url}` | `{signed_url}`, then `fetch(signed_url)` to download | utility.jsx:830-839 |
| W16 | GET + POST | `/api/app/get_file_upload_url?filename=` → `/app/get_file_upload_url`, then multipart POST to the returned S3 `url` | `filename` | `{url, fields:{key,…}}` (S3 presigned POST). Final URL is built as `"https://cdn.muapi.ai/" + fields.key` | UploadNode.jsx:51-70; RenderField.jsx:65-84; RenderApiField.jsx:83-102 |
| W17 | POST | `/api/app/calculate_dynamic_cost` → `/app/calculate_dynamic_cost` | `{task_name:modelId, payload:formValues}` | `{cost}` | useGenerationCost.jsx:17. **Not implemented in the submodule server** (it was added in commit 224a756 and is missing at HEAD); only the parent's generic `/api/app` proxy carries it |

Proxied by `server/app/routers/workflow_router.py` but **not called by the package** (the parent's
`packages/studio/src/muapi.js` calls some of them): `GET get-workflow-defs` (router:37), `DELETE delete-workflow-def/{id}`
(:61), `POST update-name/{id}` (:69), `GET get-workflow-last-run/{id}` (:148), `GET {id}/api-inputs` (:192),
`POST {id}/api-execute` (:200), `GET run/{id}/api-outputs` (:209). The parent also calls muapi-only
`get-template-workflows`, `get-published-workflows`, `/app/interest(s)` and `/api/v1/app/calculate_dynamic_cost`
(muapi.js:441-943).

### 1b. Open-Poe-AI: `packages/agents` (axios, `BASE_URL="/api/agents"`)

| # | Method | Frontend path → upstream | Payload | Expected response | Refs (packages/agents/src/…) |
|---|---|---|---|---|---|
| A1 | GET | `/api/agents/by-slug/{slug}` → `/agents/by-slug/{slug}` | – | agent `{agent_id,id,name,description,system_prompt,icon_url,skills:[{id,name,description}],theme,is_owner,is_published,is_template,has_liked,like_count,welcome_message,initial_suggestions,…}` | AiAgent.jsx:397; components/EditAgent.jsx:73. Also `utils/server.js:1-28` `getAgentDetails` (default `http://127.0.0.1:8000/agents/{id}`) |
| A2 | GET | `/api/agents/by-slug/{slug}/{convId}` → same | – | `{history:[{role,content,attachments?,thoughts?,status?,suggestions?,timestamp}],created_at}` | AiAgent.jsx:237 |
| A3 | POST | `/api/agents/by-slug/{slug}/chat` → same | `{message, stream:false, conversation_id (client-generated UUID), attachments:[url]}` | `{request_id}` | AiAgent.jsx:574 |
| A4 | GET | `/api/api/v1/predictions/{requestId}/result` → `/api/v1/predictions/{id}/result` | – | `{conversation_id, messages:[{role:"assistant",content,thoughts?} \| {type:"pulse",content}], status:"completed"\|"succeeded"\|"failed", is_complete, suggestions[], error}`, polled every 1s (comment says backend fn `execute_agent_chat_background`) | AiAgent.jsx:593-660 |
| A5 | PUT | `/api/agents/by-slug/{slug}` → same | `{theme}` (AiAgent.jsx:279) or full `{name,description,system_prompt,icon_url,skill_ids,theme,is_published,is_template}` (EditAgent.jsx:298) | any | as listed |
| A6 | DELETE | `/api/agents/by-slug/{slug}` | – | any | EditAgent.jsx:130. **Not in the Poe server** (agent_proxy.py has only PUT) |
| A7 | POST | `/api/agents/by-slug/{slug}/like?is_like=bool` → same | query only | `{has_liked, like_count}` | AiAgent.jsx:495; ProfileAgent.jsx:97 |
| A8 | GET | `/api/agents/{agentId}/profile` → same | – | `{agent:{…,has_liked,like_count,owner_username,owner_email,created_at,…}, …}` | ProfileAgent.jsx:66 |
| A9 | GET | `/api/agents/skills` → same | – | `[{id,name,description}]` (the tool catalog) | EditAgent.jsx:74, 688-736 |
| A10 | POST | `/api/agents/suggest` → same | `{prompt}` | `{name,description,system_prompt,recommended_skill_ids,welcome_message,initial_suggestions}` | CreateAgent.jsx:37 |
| A11 | POST | `/api/agents` → `/agents` | `{name,description,system_prompt,skill_ids,welcome_message,initial_suggestions,is_published:false,is_template:false}` | `{agent_id}` | CreateAgent.jsx:52 |
| A12 | POST | `/api/agents/by-slug/{slug}/preview-realign` → same | `{current_prompt,new_skill_ids}` | `{proposed_prompt}` | EditAgent.jsx:270 |
| A13 | POST | `/api/api/v1/flux-schnell-image` → `/api/v1/flux-schnell-image` | `{prompt,width:1024,height:1024,num_images:1,sync:true}` | `{outputs:[url]}` | EditAgent.jsx:243 |
| A14 | GET + POST | `/api/app/get_file_upload_url?filename=`, then S3 POST | – | `{url,fields}`. Final URL is `cdn.muapi.ai/`+key (or the vadoo CloudFront host) | AiAgent.jsx:419-437; EditAgent.jsx:202-220 |
| A15 | POST | `/api/workflow/cloudfront-signed-url` | `{url}` | `{signed_url}` | AiAgent.jsx:315 |

Listing endpoints are **not in the package**. They live in the demo `client/app/agents/page.js:105-107` and the parent
`packages/studio/src/muapi.js:484-531`: `GET /agents/user/agents`, `/agents/templates/agents`, `/agents/featured/agents`,
`/agents/user/conversations`.

### 1c. Open-AI-Design-Agent: `packages/design-agent` (axios, `API="/api/v1/creative-agent"`)

Auth headers: `Authorization: Bearer <localStorage.token>` or `x-agent-embed-code` (CreativeCanvas.jsx:171-177). The
submodule server ignores both and uses `MU_API_KEY`.

| # | Method | Path (prefix `/api/v1/creative-agent` unless absolute) → upstream is the same path on muapi | Payload | Expected response | Refs (src/CreativeCanvas.jsx) |
|---|---|---|---|---|---|
| D1 | GET | `/sessions` | – | `[{id,name,asset_count,…}]` | 287 |
| D2 | POST | `/sessions` | `{}` | `{id}` | 632 |
| D3 | PATCH | `/sessions/{id}` | `{name}` | any | 923 |
| D4 | DELETE | `/sessions/{id}` | – | any | 941 |
| D5 | GET | `/sessions/{id}/messages` | – | `[{role,content,events:[…],attachments,timestamp,skill_name}]` | 571 |
| D6 | PATCH | `/sessions/{id}/messages` | `{messages:[…]}` (the client persists the whole transcript) | any | 542, 819 |
| D7 | POST | `/sessions/{id}/chat` | `{message, model:"gpt-5-mini", messages_snapshot, canvas_state:{nodes:[{asset_id,kind,x,y,w,h,z,locked}],…}}` | `{job_id}` | 783-805 |
| D8 | POST | `/sessions/{id}/run-skill` | `{skill_name, inputs:{[skill.inputs[0]]:text}, messages_snapshot, model:"gpt-5-mini"}` | `{job_id}` | 791-805 |
| D9 | GET | `/jobs/{jobId}/events?since=cursor` | – | `{events:[{id,job_id,type,payload}], cursor, done, approved}`. Event types: `text`,`info`,`error`,`tool_call{name,args}`,`tool_result{name,result,asset}`,`plan_propose{title,nodes:[{id,label,tool,est_credits,depends,notes}],total_credits}`,`canvas_op{op:"move"\|"arrange",args}`. Polled every 1.2s, 6-min stall timeout | 305-545, 521; components/PlanVisualizer.jsx |
| D10 | POST | `/jobs/{jobId}/approve` and `/jobs/{jobId}/reject` | `{}` | any | 549 |
| D11 | GET | `/sessions/{id}/jobs` | – | `[{id,status:"pending"\|"processing"\|…}]` (resumes active jobs) | 599 |
| D12 | GET | `/sessions/{id}/assets` | – | `[{asset_label:"asset_N",url,kind,source_tool,model,prompt}]` | 621 |
| D13 | POST | `/sessions/{id}/assets` | `{url,kind,source_tool:"upload"}` | `{asset_label}` | 684 |
| D14 | GET | `/agent-skills` | – | `[{name,description,inputs:[…]}]` | 298 |
| D15 | GET | `/api/v1/get_upload_url?filename=` → `/api/v1/get_upload_url` | – | `{url,fields}` | 654 |
| D16 | POST | `/api/v1/upload-binary` (multipart: `x-proxy-target-url` + fields + file) | – | `{status:"success"}`. The server POSTs the file to S3 (muapi_helper.py:65-87). Final URL is `cdn.muapi.ai/`+key | 670-678 |

Generation tool names the UI recognises: `generate_image, generate_video, image_to_video, edit_image, edit_video,
enhance_image` (CreativeCanvas.jsx:37-44). The server also proxies endpoints the UI never uses: `POST jobs/{id}/cancel`,
`GET jobs/{id}/status`, `GET /api/v1/creative-agent/account/balance` (creative_agent_router.py:83-128). The parent
itself calls `/api/v1/account/balance`.

---

## 2. Generic inference versus muapi product backends

| Package | Generic model inference | Muapi product backend |
|---|---|---|
| workflow-builder | **None directly.** Node execution (W6) and full runs (W4/W5) call models, but only inside muapi's run, node-run and history model. | **Workflow engine:** def storage (W2, W3, W13, W14, plus defs/delete/rename), the DAG runner with `{{node.outputs[0].value}}` template resolution, per-node runs and run history (W4-W7), video-combiner (server-side ffmpeg), and third-party "API nodes" (wavespeed/straico/runware/genvr, W8). **Model catalog and schemas** (W1, W8). **Pricing** (W17). **LLM "architect"** that writes workflow JSON (W9/W10). **Community:** publish, template, category, plus parent-only template and published listings (W11-W13). **Storage:** upload URL and CloudFront signing (W15, W16). |
| agents | **A13** `flux-schnell-image` (sync text-to-image, used for the agent avatar) | **Agent CRUD** (A1, A5, A6, A11). **Conversations** (A2). **LLM chat runtime with tool or skill calls**, run async with a pulse/status stream (A3, A4). **Skills catalog** (A9). **LLM helpers** suggest and realign (A10, A12). **Social:** likes, profile, featured, templates (A7, A8, listings). **Storage** (A14, A15). |
| design-agent | None | **The whole creative-agent runtime:** sessions, messages, assets and labels (D1-D6, D11-D13). The LLM planner and tool loop with plan approval gating, credit estimates, canvas ops and an event log (D7-D10). The skills catalog (D14). Storage (D15, D16). |

---

## 3. The `server/` folders

| | Vibe-Workflow `server/` | Open-Poe-AI `server/` | Open-AI-Design-Agent `server/` |
|---|---|---|---|
| Framework | FastAPI + uvicorn + httpx (`app/main.py:13-16`), Dockerfile, docker-compose. Python 3.13 | FastAPI + httpx (`app/main.py:11-23`) | FastAPI + httpx (`app/main.py:13-16`) |
| Files | `routers/workflow_router.py` (214), `routers/app_router.py` (14), `utils/workflow_helper.py` (153) | `routers/agent_proxy.py` (91), `utils/agent_helper.py` (50) | `routers/creative_agent_router.py` (188), `utils/muapi_helper.py` (87) |
| What it does | 22 routes, each a hard-coded `https://api.muapi.ai/workflow/...` URL passed through `proxy_request_helper` with `x-api-key` (workflow_helper.py:21-153). Upload URL goes to `/app/get_file_upload_url` (:117-121) | Generic `proxy_request(method, path)` to `MUAPI_BASE_URL` (default api.muapi.ai) (agent_helper.py:10-50). 17 routes, including `/api/v1/predictions/{id}/result`, `/api/v1/flux-schnell-image`, `/app/get_file_upload_url`, `/workflow/cloudfront-signed-url` | 18 routes to `API_SUFFIX` (default api.muapi.ai). Its one non-trivial piece is `proxy_s3_upload`, a server-side multipart POST to S3 to avoid CORS (muapi_helper.py:65-87) |
| DB | None (`sqlalchemy`/`asyncpg` in requirements.txt, never imported) | None | None (sqlalchemy/asyncpg listed, unused) |
| LLM | None locally. Architect runs on muapi | None locally. Chat, suggest and realign run on muapi; the model is unknown and server-side | None locally. The client sends `model:"gpt-5-mini"`. The planner's system prompt lives on muapi (CanvasArea.jsx:1180 comment "see SYSTEM_PROMPT") |
| Env | `MU_API_KEY` | `MUAPI_BASE_URL`, `MU_API_KEY` (a committed `server/.env` exists; value redacted here) | `MU_API_KEY`, `API_SUFFIX` |
| Auth / multi-user | Single shared key. CORS `localhost:3000` | Same | Same; ignores the Bearer token and embed code |
| Gaps against its own frontend | missing `/api/app/calculate_dynamic_cost` | missing `DELETE /agents/by-slug/{slug}` and the listing routes the parent uses (`user/conversations`) | `account/balance` mounted under the creative-agent prefix (router:124) |
| Self-hostable replacement? | **No.** It is a thin proxy, and the parent's `app/api/workflow/[[...path]]` and `app/api/app/[[...path]]` already do the same | **No**, same as the parent's `app/api/agents` and `app/api/api/v1` | **No**, same as the parent's `app/api/v1/creative-agent`, `get_upload_url` and `upload-binary` routes |

**Effort to make each server provider-agnostic.** There is nothing to swap, because none of them makes an LLM or media
call. Making one "provider-agnostic" means writing the backend from zero. Python or TypeScript is a free choice;
TypeScript inside the parent avoids a second runtime. The estimates in section 6 assume that.

**Shared infrastructure needed by all three rewrites** (build once in the parent):
1. **Provider layer:** an LLM chat-completions client with tool calling through an OpenAI-compatible API (OpenAI or
   OpenRouter cover Google and Anthropic too). Media adapters for fal, Replicate, OpenAI Images, Google Veo/Imagen and
   others, each with submit, poll and normalize to `{outputs:[url]}`.
2. **Model registry:** one source of truth that emits (a) the workflow `node-schemas` JSON-Schema catalog, (b) agent
   `skills`, and (c) design-agent tools.
3. **Storage:** S3-compatible (R2, S3, MinIO) or local disk. Implement `GET …get_file_upload_url` returning a presigned
   POST `{url,fields}` to keep the contract, plus a public or signed read URL. Re-host provider outputs, since fal and
   Replicate URLs expire.
4. **DB:** SQLite or Postgres (Drizzle/Prisma) for workflows, runs and node_runs, agents, conversations and messages,
   creative sessions, jobs, events and assets.
5. **Background execution:** DAG runs, agent tool loops and video generations take minutes. That needs a long-running
   Node process or worker (pg-boss/BullMQ, or in-process for a single-user desktop/self-host build). Serverless route
   handlers alone are not enough.
6. **ffmpeg** for the workflow video-combiner node.

---

## 4. How schemas and catalogs are sourced

* **Workflow node and model schemas are fetched from muapi at runtime.** `GET /workflow/{id}/node-schemas` (W1,
  NodeFlow.jsx:312-316), or injected by the host through the `initialNodeSchemas` prop (WorkflowBuilder.jsx:7-24). The
  parent fetches them from muapi itself (studio `muapi.js:754`, `WorkflowStudio.jsx:840`). Every node component derives
  its model list and form from `nodeSchemas.categories.<cat>.models[id].input_schema.schemas.input_data` (for example
  ImageNode.jsx:27-31 and 261; TextNode.jsx:28-48; NodesNavbar.jsx:60-112 groups them by id substrings such as
  "edit", "upscale" and "passthrough").
  * `utility.jsx` has static lists (`imageModels`, `videoModels`… ~158 ids, :4-640) with **empty `input_params`**.
    They are effectively dead: NodesNavbar shadows them with schema-derived lists (:69-72). Only these are really
    static and used: the `*-passthrough` input nodes, `concatModels` (prompt-concatenator, :642), `videoCombinerModels`
    (:663) and `apiNodeModels` (wavespeed/straico/runware/genvr, :706-820, filtered against the backend
    `categories.api`, NodeFlow.jsx:142-150, 294-301).
  * API nodes take a **user-supplied third-party API key** that is sent to muapi in node params (ApiNode.jsx:420-433).
  * Display names: `SPECIAL_MODEL_NAMES` and `formatName(id)` (NodeFlow.jsx:133-140).
  * A replacement only has to emit the same JSON-Schema-per-model shape from our registry. Each model needs a
    category, id and `input_schema.schemas.input_data` (properties with type, enum, default, title and description),
    and field names such as `prompt`, `image_url`, `images_list` and `video_url`, which the node UIs and edge-handle
    logic depend on (NodeFlow.jsx:1067-1260).
* **Agent tools are fetched at runtime:** `GET /agents/skills` returns `[{id,name,description}]` (EditAgent.jsx:74).
  Agents store `skill_ids`; the tool implementations exist only on muapi. There is no per-agent LLM model selection in
  the UI: the model is decided server-side.
* **Design agent:** the skills come from `GET /creative-agent/agent-skills` (`{name,description,inputs}`). The tool
  names are implied by the UI set (CreativeCanvas.jsx:37-44). The LLM is hard-coded `"gpt-5-mini"` in the request
  (:786, :800). Model choice per tool is entirely server-side.

---

## 5. Hard-coded muapi, cdn.muapi.ai and vadoo references (frontend packages)

**Functional (must change):**
* Upload final-URL prefix `https://cdn.muapi.ai/` in workflow-builder UploadNode.jsx:70, RenderField.jsx:84 and
  RenderApiField.jsx:102. RenderApiField.jsx:22 treats `cdn.muapi.ai` URLs as images. Agents: AiAgent.jsx:437 and
  EditAgent.jsx:220 (vadoo `d3adwkbyhxyrtq.cloudfront.net` when `usedIn==="vadoo"`). Design agent:
  CreativeCanvas.jsx:678.
* The CloudFront signed-URL download flow: utility.jsx:824-855, AiAgent.jsx:315.
* Workflow presets use demo assets on `cdn.muapi.ai/assets/demos/*` (utility.jsx:872-1196, ~20 URLs) and a vadoo
  CloudFront mp4 (utility.jsx:671).
* `is_vadoo:false` in the save payload (NodeFlow.jsx:1301). `usedIn="muapiapp"|"vadoo"` switches select the user
  context and URL prefix (AiAgent.jsx:124-150, CreateAgent.jsx:15-22, EditAgent.jsx:20-27, CreatePage/EditPage/
  AgentProfile.jsx:6, ProfileAgent.jsx:47-54).
* `utils/server.js:3` defaults to `http://127.0.0.1:8000/agents`. AiAgent.jsx:18 has a commented-out
  `https://api.muapi.ai/agents`.
* The design-agent `model:"gpt-5-mini"` (CreativeCanvas.jsx:786, 800).
* The parent's own coupling (out of scope, but relevant): `middleware.js:17-42` (CSP `*.muapi.ai`, a `/api/v1`
  rewrite to api.muapi.ai) and `MUAPI_BASE` in every `app/api/**/route.js`.

**Branding and copy:**
* AiAgent.jsx:402 "MuAPI Powered Intelligence."
* CreativeCanvas.jsx:1249 `mailto:support@vadoo.tv`; :1331 and :1694 link `https://muapi.ai/docs/design-agent-api`;
  :86 comment "muapiapp links (Explore, Top Up)"; :99 localStorage key `muapi_agent_session_*`; `$ balance` /
  `creditConversionRate` credit UI (:73, :1243).
* useGenerationCost.jsx:16 comment "muapiapp runs on 8000".
* READMEs are heavily muapi-branded (Vibe-Workflow/README.md:5,28,62,118-166; Open-AI-Design-Agent/README.md
  passim; Open-Poe-AI/README.md:72,87). Demo client `next.config.mjs` allows image host `cdn.muapi.ai`
  (Open-Poe-AI/client/next.config.mjs:8). `Open-AI-Design-Agent/client/.env.example` points at
  `https://dev.muapi.ai/api/v1/creative-agent`.

---

## 6. Recommendation per submodule

A common approach applies to all three. Keep the **frontend packages**, but **fork** them: the `cdn.muapi.ai` prefix,
the branding and the `usedIn` switches must be patched. Ideally the upload helpers should use the `url` returned by the
backend instead of building one. Implement the backends **inside the parent Next.js app at the same URL contracts**
(the parent already owns these route paths), plus a worker process for long jobs. Delete the Python servers; they add
nothing.

### Vibe-Workflow: (b) rewrite in the parent. Effort **L**
* Why: the node canvas UI is valuable and fully schema-driven, so feeding it our own registry's node-schemas makes it
  provider-agnostic for free. The backend is a well-understood problem: store a DAG, topologically sort it, resolve
  `{{ node.outputs[0].value }}` templates, call providers, record node_runs.
* Scope:
  * MVP (M): W1-W7 and W16, plus a stub for W17 cost (or a cost table).
  * Then (S-M): video-combiner needs ffmpeg. Thumbnail, category and rename are trivial.
  * Architect W9/W10 (M): an LLM with JSON-schema output producing `{message,suggestions,workflow}`.
  * Drop or defer: publish, template and community listings (W11, W12, parent `get-published`/`get-template`) and
    `api-execute`/`api-inputs`. Replace W15 CloudFront signing with a direct or presigned URL.
  * Drop API nodes (wavespeed/straico/runware/genvr), or re-scope them as a "custom provider" node; they currently
    send third-party keys.

### Open-Poe-AI agents: (b) rewrite in the parent. Effort **M–L** (or (c) replace with a simpler chat if agents are not core)
* Why: the core is a standard tool-calling chat loop: system_prompt plus skills as tools, each tool backed by our media
  adapters, run through OpenAI or OpenRouter. The contract is small: about 12 endpoints. The async contract
  (`chat` returns `request_id`, then poll `/api/v1/predictions/{id}/result` for `messages` with `pulse` entries) can be
  served from a job table.
* Scope:
  * CRUD, conversations and the skills catalog (M).
  * Chat runtime with tools (M).
  * Suggest and realign are single LLM calls (S).
  * A13 maps to any image provider (S).
  * Likes, featured and templates: keep as local flags and seed data, or drop (S).
  * Note: `/api/v1/predictions/{id}/result` is also muapi's **generic** media-polling path. If the parent's own media
    layer reuses it, the agent job ids must not collide with it, or route them separately.

### Open-AI-Design-Agent: (b) rewrite in the parent if strategic, effort **L–XL**; otherwise (c) drop or defer for v1
* Why: the UI is the thinnest client of the three. All the intelligence is server-side and undocumented: the planner
  system prompt, `plan_propose` with per-node `est_credits` and dependencies, approve/reject gating, tool execution with
  `asset_N` labelling, `canvas_op` move/arrange using `canvas_state`, skills with typed inputs, and an event log with
  cursor polling and resumable jobs.
* Reproducing it means designing an agent (prompt, tools, plan/approve state machine) from scratch, with a durable
  event store and a background worker.
* If kept, phase it:
  1. Sessions, messages and assets CRUD plus upload (S-M).
  2. A chat job with tool loop and event log, without plans (M).
  3. Plan/approve, canvas ops and skills (M-L).

### Overall sequencing
1. Provider layer, model registry, storage, DB and worker (L, shared).
2. Workflow (L).
3. Agents (M–L).
4. Design agent, or drop it.

In the meantime the feature flags can hide the agents and design-agent tabs when no muapi key is configured.
