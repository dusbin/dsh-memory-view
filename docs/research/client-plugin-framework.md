# REPORT: DSH web client plugin framework

Read-only research of the **DeepSeek Harness (DSH) browser client-plugin framework**, aimed at writing a *memory-viewer* client plugin that adds UI (a session-header button + overlay) and reads session state.

All paths below are relative to the installed tree root
`H = /Users/robinddu/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`
References use `H/<pkg>/…` plus `file:line`. Line numbers are exact for the type (`.d.ts`) files; bundle (`.js`) line numbers are exact for the quoted hunks.

Reference plugins read fully first (conventions):
- `workspace/robinddu/dsh-attention/lib/client.js` (712 lines)
- `workspace/robinddu/dsh-chat-fold/lib/client.js` (885 lines)

---

## 1. How a client plugin loads, and the ctx namespaces it can see

### 1.1 Two‑level loading model

There are **two different `inject` arrays** and they must not be confused:

1. **`package.json → dsh.client.inject`** — *module-graph edges* (browser-bundle dependencies). The node half of `dsh-client-modules` scans Loader entries for packages whose `dsh.client.platform === 'web'`, composes those rows into `window.__DSH_BOOT__`, and serves each bundle (`H/dsh-client-modules/lib/index.js:389-395` — `if (decl === void 0 || decl.platform !== 'web')` skip; requires the package to export a `./client` subpath, same file ~395). `dsh.client.inject` values are **module ids (package names)** that must be registered in the module table before this package's bundle is used.
2. **`exports.inject` inside the bundle** — a *Cordis service gate*. The bundle body is a CJS factory registered via
   `window.__ModuleLoader__.load({ id: <package name>, factory: (require) => … })` and returns `module.exports` whose keys are `{ name?, inject, apply }`. `inject` lists the **ctx service names** the plugin needs; the loader activates the plugin only once those services exist (standard Cordis `Inject`, see `H/cordis/lib/types/registry.d.ts:13-15`). Examples: `dsh-attention/lib/client.js:650` `exports.inject = ['slots','sessions']`; `dsh-chat-fold/lib/client.js:785` `exports.inject = ['slots']`; shipped `dsh-client-hmr/lib/client.js:21` `const inject = ['loader','modules']`; shipped runtime `H/dsh-client-runtime/lib/client.js` (tail) `const inject = ['connection','typert','remote','remote.commands']`.

A browser "plugin" is therefore a **Cordis plugin** whose body runs on the client root ctx: `exports.apply(pluginCtx, config)` (the reference plugins receive `(pluginCtx, config)` and use `ctx.effect(...)`, `ctx.slots.*`, `ctx.sessions.list`). Everything the plugin registers (slot entries, event listeners, service provides) is tied to the calling fiber: "disposal through the caller's `ctx.effect` (fiber unload = cascade)" (`H/dsh-client-runtime/lib/types/client/slots.d.ts:62`). The client module system remembers `<style data-plugin>` tags per module and removes them on unload/invalidate (`H/dsh-client-modules/lib/types/client/manifest.d.ts` — `ClientModuleRecord.styles`; removal code `H/dsh-client-hmr/lib/client.js:27-29` `removeOwnedStyles`).

Bundle factory materialization is lazy and memoized; requiring another registered bundle recursively materializes it; resolution order is seed word → memoized record → graph row → registered factory → throw (`H/dsh-client-modules/lib/types/client/manifest.d.ts`, module doc ~lines 7-25). Plugins may `require('react')`, `require('react-dom')`, `require('react/jsx-runtime')` and cross-package bundle modules such as `@deepseek-ai/dsh-client-runtime/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots` (observed require words across shipped bundles).

### 1.2 The web roster that must be mounted

`H/dsh-web-app/cordis.patch.yml` is the web profile patch. The browser-roster rows (`dsh.client` dual-face packages) are inserted there, lines 176-295 in graph order: `modules` (client-modules, :159-160), `connection` (:164-171), `api-remotes` (:173-174), `client-runtime` (:176-177), `cordis-client-runner` (:179-180), `ui-theme`, `locale`, `ui-layout`, `ui-renderer`, `ui-sidebar`, `ui-settings(+general/models/plugin-inventory)`, `ui-conversation`, `ui-brand-official`, `ui-attachment`, `ui-tool`, `ui-cordis`, `ui-workflow-run`, `ui-deliverables`, `ui-workspace`, `ui-input-trigger`, `ui-commands`, `ui-skill`, `ui-subagent`, `ui-reference`, `ui-jobs`, `ui-goal`, `ui-message-feedback`, `ui-model-selection`, `ui-permission`, `ui-agent-preset`, `ui-settings-plugins`, `ui-plan`, `ui-user-questions`, `ui-trajectory`. A plugin therefore only gets a namespace if the providing row is in this roster.

### 1.3 ACTUAL ctx namespace names (typed, client side)

The namespace set is the union of `interface Context` augmentations on `@deepseek-ai/cordis` shipped by the client halves of the web-profile roster. From the declaration files (each listed with its `declare module '@deepseek-ai/cordis' { interface Context { … } }` block):

| ctx member | type | declared by | ref |
|---|---|---|---|
| `slots` | `SlotRegistry` (SlotCore register/inject/install…) | `@deepseek-ai/dsh-client-runtime` | `H/dsh-client-runtime/lib/types/client/index.d.ts:109` |
| `conversationEvents` | `ConversationEventRegistry` | dsh-client-runtime | same file `:111` |
| `conversationViews` | `ConversationViewRegistry` | dsh-client-runtime | same file `:113` |
| `sessions` | `ISessions` | dsh-client-runtime | same file `:115` (provided via `rootCtx.reflect.provide('sessions', this)`, `H/dsh-client-runtime/lib/client.js:8948`) |
| `workspaces` | `IWorkspaces` | dsh-client-runtime | `:117` (provide at `lib/client.js:9843`) |
| `modules` | `ClientModuleLoader` | `@deepseek-ai/dsh-client-modules` | `H/dsh-client-modules/lib/types/client/manifest.d.ts` (Context `modules`) |
| `clientModules` | host module registry | dsh-client-modules node half | `H/dsh-client-modules/lib/types/index.d.ts` (Context `clientModules`) |
| `connection` | `HostConnectionHandle` | `@deepseek-ai/dsh-client-connection` | `H/dsh-client-connection/lib/types/rpc-host.d.ts` (Context `connection`) |
| `remote` | `TypertClientRemote` (typed remote namespaces incl. goal/file-reference/message-feedback/…) | `@deepseek-ai/dsh-api-remotes` | `H/dsh-api-remotes/lib/types/client/index.d.ts` (Context `remote` ~34) |
| `locale` | `LocaleRuntime` | `@deepseek-ai/dsh-client-locale` | `H/dsh-client-locale/lib/types/client/index.d.ts` (Context `locale`) |
| `theme` | `ThemeRuntime` | `@deepseek-ai/dsh-client-ui-theme` | `H/dsh-client-ui-theme/lib/types/client/index.d.ts` (Context `theme`) |
| `layout` | `ILayout` (`toggleSidebar/openDetails/closeDetails`) | `@deepseek-ai/dsh-client-ui-layout` | `H/dsh-client-ui-layout/lib/types/client/index.d.ts:13-18`, face `H/dsh-client-ui-layout/lib/types/client/service.d.ts` |
| `uiRenderer` | `UiRendererService` | `@deepseek-ai/dsh-client-ui-renderer` | `H/dsh-client-ui-renderer/lib/types/client/index.d.ts` (Context `uiRenderer`) |
| `conversation` | `IConversation` | `@deepseek-ai/dsh-client-ui-conversation` | `H/dsh-client-ui-conversation/lib/types/client/index.d.ts` (Context `conversation`; face `service.d.ts:25`) |
| `commandUi` | `CommandUiRuntime` | dsh-client-ui-commands | `H/dsh-client-ui-commands/lib/types/client/index.d.ts` |
| `inputTriggers` | `InputTriggerServiceContract` | dsh-client-ui-input-trigger | `H/dsh-client-ui-input-trigger/lib/types/client/index.d.ts` |
| `modelDirectories` | `ModelDirectoryResolver` | dsh-client-ui-model-selection | `H/dsh-client-ui-model-selection/lib/types/client/service.d.ts` |
| `settingsScope` | `SettingsScopeBinder` | dsh-client-ui-settings | `H/dsh-client-ui-settings/lib/types/client/settings-scope.d.ts` (service name `settingsSchema` also registered, `super(ctx,'settingsSchema')` in bundle) |
| `sessionLogDownload` | `SessionLogDownloadController` | dsh-session-log-export | `H/dsh-session-log-export/lib/types/client/index.d.ts` |
| `dynamicCordisRunner`, `cordisInspect`, `timer` | runner services | dsh-cordis-client-runner | `H/dsh-cordis-client-runner/lib/types/client/index.d.ts`, `inspect-registry.d.ts`, `timer.d.ts` |
| `chatFileMentions` | optional, reach via `ctx.get` | dsh-client-ui-conversation | `H/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:429-434` |
| `loader` | `Loader` (entry tree) | vendored cordis-plugin-loader | `H/cordis-plugin-loader/lib/types/index.d.ts` (Context `loader`) |
| `logger`, `events`, `reflect`, `registry` | built-in cordis | @deepseek-ai/cordis | `H/cordis/lib/types/context.d.ts` (~:28-48) |

Also merged at runtime: client-scope `agent` Typert context (`H/dsh-client-runtime/lib/types/client/index.d.ts` ~:41-46). Events available on ctx: `slots/changed(key)` and `connection/reset` (same file `:47-68`), plus whatever service events others emit (e.g. `theme/change`, used by ui-layout `H/dsh-client-ui-layout/lib/client.js`).

**Explicit negatives (important for a memory viewer):** there is **NO** `goal`/`goals`, `jobs`, `plan`, `skills`, `settings` ctx service on the client side. Those features are per-session **projections** (see §2) surfaced to slot components via `useProjection`, plus list-row state (`jobsBySession`) — never standalone ctx namespaces. Grep of all client `.d.ts` Context augmentations shows no such members; ui-goal/ui-jobs/ui-plan register only slots/events and read projections. Host-domain RPCs (goal etc.) are reachable as generated namespaces under `ctx.remote` (typed via `H/dsh-api-remotes/lib/types/client/index.d.ts` import list).

A plugin that touches a namespace should name it in `exports.inject` so the loader waits for the service (example: ui-jobs `inject = ['sessions','slots','locale']`, `H/dsh-client-ui-jobs/lib/client.js:253-257`).

---

## 2. `ctx.sessions` — list rows, subscribe API, projections, message content

### 2.1 The `ctx.sessions` face (`ISessions`, `H/dsh-client-runtime/lib/types/client/contract/sessions.d.ts`)

- `readonly list: ObservableSnapshot<SessionListState>` (`:22`) — the list store (also holds `current`).
- `readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>` (`:24`).
- Behavior verbs: `open(id)` (`:211`), `openSubagent(address)`, `clear()`, `fork(...)`, `provide(descriptor)`, `scope(id)`, `scopeOf(ctx)`, `sessionOf(ctx)`, `binding(id): SessionBinding | undefined` (`:341`), plus `search(query, signal)` (`:76-78`, request-local host message-content search, bounded — `SessionSearchResultItem = {sessionId, snippet}` at `H/dsh-client-runtime/lib/types/client/sessions/manager.d.ts:16-19`; cap `searchResultLimit = 20` in `service.d.ts`).

**Store shape is exactly `{ids, byId, current, …}`.** `SessionListState` (`H/dsh-client-runtime/lib/types/client/sessions/service.d.ts:67-85`):

```ts
interface SessionListState {
  ids: SessionId[];                                    // :69 host-list order
  byId: Record<SessionId, SessionSummary>;             // :71
  current: SessionId | undefined;                      // :72  the selected session
  phase: SessionListPhase;                             // :74  'pending' | 'ready'
  subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>; // :76
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>;          // :82
  currentAddress: SubagentAddress | undefined;         // :84
}
```

### 2.2 Every field of one session row — `SessionSummary` (`service.d.ts:30-61`)

| field | type | meaning (doc excerpt) |
|---|---|---|
| `id` | `SessionId` | `:31` |
| `title?` | `string` | latest durable log-backed title (`:33`) |
| `displayTitle` | `string` | human-facing label: durable title, project basename, then session id (`:35`) |
| `cwd?` | `string` | (`:36`) |
| `agentPreset?` | `string` | composition this session runs (`:42`) |
| `parentId?` | `SessionId` | (`:43`) |
| `origin?` | `'subagent'` | coarse durable origin (`:45`) |
| `running` | `boolean` | (`:46`) |
| `pendingInteraction?` | `PendingInteractionStatus` | blocking user interaction (`:48`) |
| `completed?` | `boolean` | finished while not selected/opened — the green "done" reminder (`:50`) |
| `blank` | `boolean` | empty-log bit (`:57`) |
| `updatedAt` | `number` | (`:58`) |
| `projectionValues?` | `Readonly<Partial<SessionProjectionMap>>` | host-computed projection values retained by the object layer (`:60`) |

**The row carries NO message text/content** — only status + metadata + whatever host projection values the list layer retains.

### 2.3 Subscribe API

`ctx.sessions.list` is a `SnapshotStore<SessionListState>`; the observable contract (`H/dsh-client-runtime/lib/types/client/contract/store.d.ts`):

```ts
interface ObservableSnapshot<T> { getSnapshot(): T; subscribe(fn: () => void): () => void; } // store.d.ts:10-13
interface SnapshotStore<T> extends ObservableSnapshot<T> { update(...); set(next: T); }       // :17-24
```

Reading styles:
- Imperative (like `dsh-attention/lib/client.js:551-568`): `const snap = ctx.sessions.list.getSnapshot(); snap.ids.forEach(id => snap.byId[id]); snap.current;` then `const unsub = ctx.sessions.list.subscribe(step)`.
- React: components receive the framework **selector hooks** and call them directly — shipped usage `JobListAction({sessionId, useSessions, t})` does `const jobs = useSessions((state) => state.jobsBySession[sessionId])` (`H/dsh-client-ui-jobs/lib/client.js:117-118`). Standard-prop kits (session scope: `useSession` (per-session `ConversationSnapshot` selector), `sessionId`, `useProjection`; global: `useSessions`, `useWorkspaces`) are declared at `H/dsh-client-runtime/lib/types/client/index.d.ts:70-100`; ui-conversation adds session kit `useInput`/`inputActions` (`H/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:345-355`).
- `React.useSyncExternalStore(subscribe, getSnapshot)` over the store object also works inside slot components (see chat-fold module-level store pattern, `dsh-chat-fold/lib/client.js:84-114,698-722`).

### 2.4 Per-key projections (`SessionProjectionMap`)

Client-visible keys (merge-extensible table, declared empty at `H/dsh-session-projection/lib/types/types.d.ts`; consumers read through `useProjection(key)` which returns `undefined` uniformly for absence — `H/dsh-client-runtime/lib/types/client/sessions/projection-store.d.ts` `UseProjection`):

| key | wire value | declared in |
|---|---|---|
| `title` | `string \| null` | `H/dsh-session-title/lib/types/types.d.ts:21` |
| `goal` | `GoalProjection \| null` | `H/dsh-goal/lib/types/types.d.ts:96` |
| `plan` | `PlanProjection` | `H/dsh-plan-mode/lib/types/types.d.ts:25` |
| `todos` | `TodoItem[] \| null` | `H/dsh-tool-todo/lib/types/types.d.ts:22` |
| `sessionStats` | `SessionStatsProjection` | `H/dsh-session-stats/lib/types/types.d.ts:39` |
| `permissions` | `PermissionSelect` | `H/dsh-permission-presets/lib/types/types.d.ts:39` |
| `subagent` / `subagentTiming` | identity / timing | `H/dsh-subagent/lib/types/projection-types.d.ts:57,47` |
| `tokenUsage` / `contextPressure` / `contextBreakdown` | token-meter views | `H/dsh-token-meter/lib/types/projection.d.ts:67,69,71` |

Values are host-computed whole values pushed over the wire; client does no folding (`projection-store.d.ts`, module doc lines 1-12). Slot components read them as `useProjection('goal')` (`H/dsh-client-ui-goal/lib/client.js:242`) or `useProjection('plan')` (`H/dsh-client-ui-plan/lib/client.js:34`). A non-slot plugin has no framework `useProjection`; it can read the same key through a session's projection face if it obtains a `SessionBinding` (§2.5), or get what the host put in the row's `projectionValues`.

### 2.5 Message content — YES, per-session, windowed (`ConversationSnapshot`)

Message text **is** exposed to client ctx, but only through the **per-session conversation snapshot** — not through list rows, and not as a bulk "full log" API.

- `SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>` (`H/dsh-client-runtime/lib/types/client/contract/session.d.ts` — `SessionFace` type at file bottom ~:61; `ISession` behavior verbs include `prompt`, `cancel`, `rename`, **`loadOlder()`** (backwards pagination) etc. `:33-125`).
- `ConversationSnapshot` (`H/dsh-client-runtime/lib/types/client/sessions/conversation.d.ts:371-421`) carries:
  - `nodes: readonly ConversationNode[]` (`:378`) — the message flow. `ConversationNode` is the union of **content-bearing node kinds** (`:264`): `UserMessageNode` (`content: readonly ContentBlock[]`, `:61-68`), `AssistantMessageNode` (`blocks: readonly AssistantBlock[]`, `:79-102`; `AssistantBlock` = `{kind:'text',text} | {kind:'reasoning',text} | {kind:'image'} | {kind:'tool-call',…} | {kind:'other'}`, `:30-47`), `SteeringMessageNode`, `ContextMessageNode`, `ToolResultNode` (`content: readonly ContentBlock[]`), `CommandNode`, `CompactionSummaryNode`, `TurnErrorNode`, `ModelRetryNode`, `TurnMaxTokensNode`, `UnknownSurfaceNode`.
  - `chat: ChatSnapshot` (`:376`) and `views: ConversationViewSnapshotStore` (`:374`) — the newer keyed node/location stores.
  - live status: `running`, `pending`, `queue`, `partial`, `runningCalls`, `composerPhase`, `removed`, `openState` (`'cold'|'loading'|'open'|'error'` `:404`), `hasMore`/`loadingOlder` (`:406-407`).
- **How a plugin gets it**: slot components receive `useSession` (a selector hook over this snapshot) in the standard kit; non-slot plugin code can obtain the session face via `ctx.sessions.binding(id)` (`service.d.ts:341`) whose `SessionBinding.session` is that observable, then `subscribe`/`getSnapshot`.
- **Critical caveat — window, not full log**: the snapshot is the **live event window of the opened session**, assembled client-side from the session event stream; older content is paged in with `ISession.loadOlder()` / the chat view's injected `loadOlder` (`H/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:739`). Only the **staged (current) session** has its window open (`H/dsh-client-runtime/lib/types/client/sessions/service.d.ts`, module doc lines 6-13: "the window opens ⟺ the session is on stage (today the stage is `current`)"); manager keeps "opened windows" (`manager.d.ts:248-250`). So a memory viewer can read **the current/live session's messages** freely, and must `open()` + page `loadOlder()` to walk older history; it cannot dump arbitrary past sessions' full text straight from ctx without driving the window.
- **Search is the only message-content escape hatch and it returns snippets only**: `ctx.sessions.search(query, signal)` (`contract/sessions.d.ts:76-78`) → `{sessionId, snippet}` items (`manager.d.ts:16-19`). In the web profile the full-text index row is `session-query-sqlite … openAt: never` (`H/dsh-web-app/cordis.patch.yml:30-33`), i.e. content search is off unless a deployment overrides it.

**Summary for the memory-viewer requirement:** rows (`ctx.sessions.list`) give id/title/status/timestamps/jobs and host projection summaries (sessionStats/title/goal/todos/plan/contextBreakdown/subagent/permissions/tokenUsage); live **message text/kinds for the open session come from `ConversationSnapshot`** (`useSession`/session face), windowed with `loadOlder` pagination. There is **no client-ctx full-history store** for closed sessions.

---

## 3. Slots — the registry and every seat relevant to adding UI

### 3.1 Mechanics

- **One registration API**: `ctx.slots.register({ name, id?, order?, children?, store?, inject?, locale?, label? }, Component)` — "The single registration API" `H/dsh-client-runtime/lib/types/client/slots.d.ts:58`; typed face is `SlotCore.register`. Registering a seat **declares it** and seats an entry; a `children` map declares child slots (see ui-layout/root and ui-conversation examples below). Fiber unload cascades the entry away (`slots.d.ts:62`).
- **Declaration dependency**: you can only seat an entry into a slot after the slot is *declared* by its owning entry. The portable pattern (all shipped UIs and both reference plugins) is

```js
ctx.slots.inject('conversation.session.header.actions', () => {
  const dispose = ctx.slots.register({ name: 'conversation.session.header.actions', id: 'my-viewer', order: 20 }, Button);
  return () => { dispose(); };
});
```
  (`dsh-chat-fold/lib/client.js:821-827`, `dsh-attention/lib/client.js:658-664`, shipped ui-jobs `H/dsh-client-ui-jobs/lib/client.js:266-272`.) `slots.inject(key, cb)` runs `cb` synchronously once the declaration exists and disposes on collapse/unload (`H/dsh-client-runtime/lib/client.js`, `inject()` implementation; docs in `slots.d.ts`).
- **List seats render entries by ascending `order`; negative orders reserved for static context** (`H/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:86-95`). List entries need `id` (+`order`); `single`/`keyed`/`chain` seats have their own rules (single = one occupant shadows; chain = selector election).
- **Do not register `root`** (single seat occupied by ui-layout AppFrame — registering shadows the whole app): `H/dsh-client-runtime/lib/types/client/slots.d.ts` `root` slot doc (~:36-56).

### 3.2 Conversation slots — declared by `ui-conversation` (`H/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:51-339`; declarations happen in `register({name:'conversation'|'conversation.session'|'conversation.session.header'|…, children:{…}},…)` at `H/dsh-client-ui-conversation/lib/client.js:9954-10070`)

Exact ids (kind / scope):

- **Session header — the per-session action row**:
  - `'conversation.session.header.actions'` — `kind:'list', scope:'session'` (`slots.d.ts:96-100`) — *the* slot for a header action button next to the title.
  - `'conversation.session.header.utilities'` — list, right-aligned utilities (`:105-109`).
  - `'conversation.session.header.lineage'` — single; breadcrumb/subagent lineage title (`:81-85`; ui-subagent occupies it).
  - `'conversation.session.header'` / `'conversation.session'` — single seats replacing the whole header/body (do not touch).
- Input/composer seats:
  - `'conversation.input.right'` — list; right end of composer tool row, before send (`:282-286`) — dsh-attention's sound toggle sits here.
  - `'conversation.input.left'` (`:270-274`), `'conversation.input.dock'` (`:244-248`), `'conversation.composer.dock'` (`:257-261`) — list; dock = full-width rows above the card; composer.dock = band under the card.
  - `'conversation.input.plan'` (`:320-324`) / `'conversation.input.model'` (`:334-338`) — single seats occupied by ui-plan / ui-model-selection.
  - `'conversation.input.overlay'` — list (declared by ui-input-trigger, `H/dsh-client-ui-input-trigger/lib/types/client/slots.d.ts`).
  - `'conversation.composer'` — chain (approval/question takeovers), `'conversation.composer.bar'` — single, `'conversation.input.attachments'` — single.
- Chat content rows:
  - `'conversation.chat.node'` — keyed per `ChatNodeKind` business-node renderer (`:123-134`); `'conversation.chat.commandview'` — keyed per command name (`:149-153`); `'conversation.chat.turnTail'` — chain under each closing assistant message (`:160-164`); `'conversation.chat.assistant-actions'` — list per finalized assistant message (`:172-176`, dsh-chat-fold's per-reply button); `'conversation.message.images'` — single.
- `'conversation.view'` — list of view tabs (chat + ui-trajectory); `'conversation.details.tool'` — single (details panel tool body).

### 3.3 Layout slots — declared by `ui-layout` (`H/dsh-client-ui-layout/lib/types/client/index.d.ts:19-81`; declared in one `register({name:'root', children:{…}}, AppFrame)` at `H/dsh-client-ui-layout/lib/client.js:405-437`)

- `'sidebar'` — single, `scope:'root'` — whole left column, occupied by ui-sidebar.
- `'conversation'` — single, `scope:'session-maybe'` — whole center column (occupied by ui-conversation).
- `'details'` — single, `scope:'session'` — **right details column**, shown when `ctx.layout.openDetails()`; occupied by ui-conversation's DetailsPanel; registering here *replaces* the column (`index.d.ts:53-66`).
- **`'shell.overlay'` — list, `scope:'root'`** — *the additive frame-wide float layer*: "the additive seat for a frame-wide surface of your own: a fresh `id` is added beside the shipped entries instead of replacing them" (`index.d.ts:68-80`). It is click-through; entries opt back into pointer events. CSS: `.overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}` with `>*{pointer-events:auto}` (`H/dsh-client-ui-layout/lib/client.js:56`). → **best in-app seat for a memory-viewer drawer/banner that must overlay the whole app but stay inside the frame.**

Panel *actions* (not slots): `ctx.layout.toggleSidebar() / openDetails() / closeDetails()` (`H/dsh-client-ui-layout/lib/types/client/service.d.ts`, `ILayout`). There is **no generic 'drawer' slot**; the available mechanisms are: `details` column (right, single), `shell.overlay` (frame float, additive), or your own DOM/portal (see §4).

### 3.4 Sidebar / workspace / settings seats

Declared by `ui-sidebar` (`H/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:12-63`) — all root scope:
- `'sidebar.workspaces'` — single; workspace/session browsing region — occupied by ui-workspace's WorkspaceBrowser (`H/dsh-client-ui-workspace/lib/client.js:2435`); its inner directory-browse variant seats: `'sidebar.workspaces.directoryFlow'`, `'conversation.hero.workspace.directoryFlow'` (`H/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts`).
- `'sidebar.settings'` — single (settings trigger); `'sidebar.footer.action'` — list, actions beside Settings; `'sidebar.brand.mark'`/`'sidebar.brand.name'` — singles.
- Workspace-level hero seats on the new-session screen: `'conversation.hero.workspace'`, `'conversation.hero.agentPreset'`, `'conversation.hero.brand.mark'` (root scope, ui-conversation slots.d.ts `:210-233`; ui-workspace occupies hero.workspace `client.js:2445`).

Declared by `ui-settings` (`H/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`): `'settings.trigger'`, `'settings.header'`, `'settings.action'`, `'settings.close'`, `'settings.section'`, `'settings.plugins.tab'`, `'settings.onboarding'`, `'settings.general.item'`; plus `'settings.plugin.item'` (ui-settings-plugins `slot-contract.d.ts`) and `'tool.call.toolview'` (ui-tool; keyed per tool render).

Exact ids asked for:
- session header action buttons → **`conversation.session.header.actions`** (list, session scope).
- right side panel or drawer contents → **`details`** (single, session scope; open via `ctx.layout.openDetails()`), **`shell.overlay`** (additive list float), or a self-owned `document.body` overlay.
- workspace / directory level → **`sidebar.workspaces`** (+ `*.directoryFlow` seats), **`conversation.hero.workspace`**.

---

## 4. Minimal client-plugin skeleton (button in the session header + full-height overlay)

Module-loader format (exactly as tsdown emits and as both reference plugins are written — CJS factory returned from `window.__ModuleLoader__.load`), no build step needed. Registers one button into `conversation.session.header.actions` and renders its own full-height overlay via a portal to `document.body` (`react-dom` is resolvable from client bundles — shipped ui-attachment/ui-message-feedback/ui-renderer/ui-subagent/ui-trajectory all `require('react-dom')`).

```js
// lib/client.js  (package id in window.__ModuleLoader__.load must equal package name)
window.__ModuleLoader__.load({
  id: 'dsh-memory-viewer',
  factory: (require) => {
    'use strict';
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var ReactDOM = require('react-dom');           // createPortal

    var DEFAULTS = { overlayHeight: '100vh', debug: false };
    function mergeConfig(base, override) {          // shallow copy, as in dsh-chat-fold
      var out = {};
      for (var k in base) out[k] = base[k];
      if (override && typeof override === 'object')
        for (var k2 in override) if (Object.hasOwn(override, k2)) out[k2] = override[k2];
      return out;
    }
    // ---- tiny module-level store for the overlay open flag (chat-fold pattern) ----
    var listeners = [];
    var open = false;
    function subscribe(fn) { listeners.push(fn); return function () {
      var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
    function getOpen() { return open; }
    function setOpen(v) { open = !!v; for (var i = 0; i < listeners.length; i++)
      try { listeners[i](); } catch (e) {} }

    function debugLog() {                            // debug logging convention
      if (!opts.debug) return;
      var a = [].slice.call(arguments); a.unshift('[dsh-memory-viewer]');
      console.log.apply(console, a);
    }
    var opts = mergeConfig(DEFAULTS, null);

    // ---- the overlay: own React tree through a portal ----
    // components mounted in slots receive framework props (useSession/sessionId/useProjection/useSessions…),
    // but a module-scope ctx captured at apply() is also reachable (attention pattern).
    var ctx = null;
    function MemoryOverlay() {
      var isOpen = React.useSyncExternalStore(subscribe, getOpen);
      if (!isOpen) return null;
      var sessionIds = [];
      try { var snap = ctx.sessions.list.getSnapshot(); sessionIds = snap.ids; } catch (e) {}
      var el = React.createElement('div', { className: 'dsh-mv-overlay' },
        React.createElement('h2', null, 'Memory viewer'),
        React.createElement('ul', null, sessionIds.map(function (id) {
          return React.createElement('li', { key: id }, id);
        })),
        React.createElement('button', { type: 'button', onClick: function () { setOpen(false); } }, 'Close'));
      return ReactDOM.createPortal(el, document.body);   // full-height overlay on body
    }

    function ViewerButton() {                            // occupant of header.actions
      var isOpen = React.useSyncExternalStore(subscribe, getOpen);
      return React.createElement('button', {
        type: 'button', className: 'dsh-mv-btn',
        onClick: function (e) { e.preventDefault(); setOpen(!isOpen); },
        'aria-label': 'Memory viewer'
      }, 'Memory');
    }

    exports.name = 'dsh-memory-viewer';
    exports.inject = ['slots', 'sessions'];             // ctx service gates
    exports.apply = function apply(pluginCtx, config) { // config = entry config
      ctx = pluginCtx;
      opts = mergeConfig(DEFAULTS, config || {});
      if (typeof document === 'undefined') return;
      var style = document.createElement('style');
      style.dataset.plugin = 'dsh-memory-viewer';       // removed automatically on unload
      style.dataset.pluginCss = 'dsh-memory-viewer/css';
      style.textContent = '.dsh-mv-overlay{position:fixed;inset:0;height:100vh;z-index:2147483000;' +
        'background:var(--dsw-alias-bg-base,#fff);overflow:auto;padding:16px;}' +
        '.dsh-mv-btn{...}';
      document.head.appendChild(style);

      // Wait for the seat declaration, then mount; dispose on teardown.
      ctx.slots.inject('conversation.session.header.actions', function () {
        var dispose = ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'dsh-memory-viewer', order: 30 },
          ViewerButton);
        return function () { try { dispose(); } catch (e) {} };
      });
      debugLog('activated', typeof ctx.sessions, typeof ctx.slots);
      // Cleanup on plugin unload/reload (HMR): tear down listeners/timers/DOM owned here.
      ctx.effect(function () {
        return function () {
          setOpen(false);
          if (style.parentNode) style.parentNode.removeChild(style);
          listeners = [];
        };
      }, 'dsh-memory-viewer: teardown');
    };
    return module.exports;
  }
});
```

Key conventions demonstrated (all mirror shipped code):
- `ctx.slots.inject(key, cb)` + `ctx.slots.register({name, id, order}, Component)`; return the disposer from the inject callback (`dsh-chat-fold/lib/client.js:821-827`, `dsh-attention/lib/client.js:658-664`).
- config arrives as `apply(pluginCtx, config)` — merge over defaults (`dsh-chat-fold/lib/client.js:787-789`, `dsh-attention/lib/client.js:652-655`).
- teardown registered with `ctx.effect(() => () => {...}, label)` (`dsh-chat-fold/lib/client.js:839-847`, `dsh-attention/lib/client.js:675-684`; ui-layout apply `H/dsh-client-ui-layout/lib/client.js:404-437`).
- debug logging = `console.log('[plugin-id]', …)` gated on `opts.debug` (`dsh-chat-fold/lib/client.js:69-77`, activation log `dsh-attention/lib/client.js:686-695`).
- data access inside the component: framework props (useSession/useSessions/useProjection, see `H/dsh-client-ui-jobs/lib/client.js:117-118`, `H/dsh-client-ui-goal/lib/client.js:242`) or module-scope `ctx.sessions.list.getSnapshot()/subscribe()` (`dsh-attention/lib/client.js:551-568`).

---

## 5. Bundle declaration & serving (`dsh.client` + `/plugins/<id>/client.js`)

- A web plugin package is a normal npm package that additionally declares `package.json → dsh.client`. The node half of `@deepseek-ai/dsh-client-modules` scans the host Loader tree for rows with a `dsh.client` declaration, keeps only `platform === 'web'` rows, requires the package to export a `./client` subpath, and composes one **boot row per package** into `window.__DSH_BOOT__` (`H/dsh-client-modules/lib/index.js:389-395`; declaration parse `:119-129`; boot graph types `WebBootEntry/WebBootGraph` in `H/dsh-client-modules/lib/types/client/manifest.d.ts`). The `dsh.client.inject` array is validated as "an array of strings" and becomes informational graph metadata + prefetch edges (`manifest.d.ts` `optionalStringArray`; `BootPluginRow.inject`), while `dsh.client.external` constrains module-graph `require` edges.
- **Module id naming**: the registration id inside `window.__ModuleLoader__.load({ id })` and every entry name in the boot graph is the **package name** (`'dsh-attention'`, `'@deepseek-ai/dsh-client-runtime'`, …). `require('@deepseek-ai/dsh-client-runtime/client')` normalizes to the same row via `stripClientSuffix` (`H/dsh-client-modules/lib/types/client/manifest.d.ts`, function doc).
- **Serving**: each bundle is fetched from **`/plugins/<id>/client.js?rev=<rev>`** where `<rev>` is the bundle content hash (url template in the node half at `H/dsh-client-modules/lib/index.js:155`; type doc `manifest.d.ts:50-51`). The webserver route prefix/suffix handling is `H/dsh-client-modules/lib/index.js:467-471` (`prefix = '/plugins/'`, `mapSuffix='/client.js.map'`, `bundleSuffix='/client.js'`). The web-app patch comments state: "the modules row … serves /plugins/<id>/client.js" (`H/dsh-web-app/cordis.patch.yml:155-158`). HTML preloads the bootstrap modules bundle; `window.__ModuleLoader__.load` queues registrations before the module system exists and switches to live mode after (`manifest.d.ts`, `ClientModuleLoaderTarget`, `DshWindow`).
- **What `inject` ids must appear in `dsh.client` so `ctx.slots` & `ctx.sessions` exist**: you need the provider bundles loaded/registered, i.e. **`@deepseek-ai/dsh-client-runtime`** (provides `slots`, `sessions`, `workspaces`, `conversationEvents`, `conversationViews`; its own client inject chain pulls `connection`, `api-remotes`, `typert-registry` — runtime's package.json `dsh.client.inject` = `['@deepseek-ai/dsh-client-connection','@deepseek-ai/dsh-typert-registry','@deepseek-ai/dsh-api-remotes']` with `platform:'web', immediately:true`). For the `conversation.session.header.actions` seat you additionally need **`@deepseek-ai/dsh-client-ui-conversation`** (it owns the seat declaration). Both reference packages declare exactly that:

`workspace/robinddu/dsh-chat-fold/package.json` (`dsh` block, verbatim; file lines 23-32):

```json
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation"
      ]
    }
  },
```

`workspace/robinddu/dsh-attention/package.json:12-19` (verbatim):

```json
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime"
      ]
    }
  },
```

(Both also export `./client` from `package.json` `exports`, e.g. `dsh-chat-fold/package.json:7-13`.) `ui-conversation`'s own `dsh.client.inject` (its package.json) shows the richer graph-declaration style: `['@deepseek-ai/dsh-client-connection','@deepseek-ai/dsh-client-locale','@deepseek-ai/dsh-client-runtime','@deepseek-ai/dsh-client-ui-settings','@deepseek-ai/dsh-api-remotes','@deepseek-ai/dsh-client-ui-layout']`.

The row must be enabled in the profile's cordis composition (the web profile's `cordis.patch.yml` `insert` block, or a deployment overlay) for its `./client` bundle to enter the boot graph; the browser plugin then activates once its `exports.inject` services exist, and its UI contributions disappear automatically on entry unload/reload (fiber cascade + style-tag cleanup; HMR path in `H/dsh-client-hmr/lib/client.js:38-56`).
