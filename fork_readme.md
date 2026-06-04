# Fork delta vs upstream `v0.8.5`

This document describes everything that differs between this fork and upstream LibreChat tag `v0.8.5`.

```
4 files changed, 123 insertions(+), 1 deletion(-)
```

| File | Δ |
|---|---|
| `api/server/routes/config.js` | +2 / −1 |
| `api/server/services/Config/filterModelSpecs.js` | +85 (new file) |
| `api/strategies/samlStrategy.js` | +6 |
| `api/strategies/samlStrategy.spec.js` | +30 |

---

## 1. ModelSpecs ACL visibility filter

Hides agent-backed `modelSpecs` from users who lack VIEW permission on the underlying agent.

### `api/server/services/Config/filterModelSpecs.js` (new, 85 lines)

Exports `filterModelSpecsByPermissions(req, modelSpecs)`.

- For each entry in `modelSpecs.list`:
  - Non-agent specs (`isAgentsEndpoint(spec.preset.endpoint) === false`) pass through unchanged.
  - Agent specs are kept only if `spec.preset.agent_id` matches an agent the user has `PermissionBits.VIEW` on, looked up via `findAccessibleResources({ userId, role, resourceType: ResourceType.AGENT, requiredPermissions: PermissionBits.VIEW })`.
  - Agent specs without an `agent_id` are dropped.
- The ACL call returns Mongo `_id` values; agent specs reference the string `id` field, so we resolve via `Agent.find({ _id: { $in: ids } }, { id: 1 }).lean()`.
- Returns a new object `{ ...modelSpecs, list: filtered }`. Original is not mutated.
- If `modelSpecs.list` is missing or `req.user` is absent, returns the input unchanged.

### `api/server/routes/config.js` (3-line wiring)

```diff
 const { getAppConfig } = require('~/server/services/Config/app');
+const { filterModelSpecsByPermissions } = require('~/server/services/Config/filterModelSpecs');
```

In the authenticated branch of `router.get('/')`:

```diff
-      modelSpecs: appConfig?.modelSpecs,
+      modelSpecs: await filterModelSpecsByPermissions(req, appConfig?.modelSpecs),
```

The unauthenticated branch is unchanged from upstream and never reaches the filter.

---

## 2. SAML `disableRequestedAuthnContext` / `authnContext` env-var knobs

Adds two opt-in passport-saml options that upstream does not expose. With both env vars unset, behaviour matches passport-saml's defaults (`RequestedAuthnContext` is sent with `PasswordProtectedTransport`) — i.e. identical to vanilla LibreChat.

### `api/strategies/samlStrategy.js` (+6)

The overrides are applied inside `getBaseSamlConfig()` so they affect both the regular `saml` strategy and the `samlAdmin` strategy. Both keys default to `undefined`, which passport-saml's constructor falls through to its own defaults via `(opt ?? default)`:

```diff
 function getBaseSamlConfig() {
   return {
     entryPoint: process.env.SAML_ENTRY_POINT,
     issuer: process.env.SAML_ISSUER,
     idpCert: getCertificateContent(process.env.SAML_CERT),
     wantAssertionsSigned: process.env.SAML_USE_AUTHN_RESPONSE_SIGNED === 'true' ? false : true,
     wantAuthnResponseSigned: process.env.SAML_USE_AUTHN_RESPONSE_SIGNED === 'true' ? true : false,
+    // Set 'true' to omit RequestedAuthnContext (Azure AD AADSTS75011 workaround)
+    disableRequestedAuthnContext: process.env.SAML_DISABLE_REQUESTED_AUTHN_CONTEXT === 'true' ? true : undefined,
+    // Custom authentication context class reference(s), comma-separated
+    authnContext: process.env.SAML_AUTHN_CONTEXT
+      ? process.env.SAML_AUTHN_CONTEXT.split(',').map((ctx) => ctx.trim())
+      : undefined,
   };
 }
```

### Environment variables

| Variable                               | Type                   | Default                                                                                                              | Effect                                                                                                                                                                                                                                 |
| ----------------------------------------| ------------------------| ----------------------------------------------------------------------------------------------------------------------| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `SAML_DISABLE_REQUESTED_AUTHN_CONTEXT` | `"true"` to opt in     | unset → `undefined` (passport-saml default: `false`)                                                                 | When literal `"true"`, sets `disableRequestedAuthnContext: true` so the `<samlp:RequestedAuthnContext>` element is omitted from the AuthnRequest. Any other value (or unset) leaves it `undefined` and passport-saml uses its default. |
| `SAML_AUTHN_CONTEXT`                   | comma-separated string | unset → `undefined` (passport-saml default: `["urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport"]`) | When set, split on `,` and trimmed; passed to passport-saml as the `authnContext` array. Ignored at the wire if `disableRequestedAuthnContext` is `true` because the whole element is then suppressed.                                 |

### `api/strategies/samlStrategy.spec.js` (+30)

Test-related additions on top of the upstream spec file:

1. A module-level `let samlOptions;` plus a side-effect inside the existing `SamlStrategy.mockImplementation` that captures the options from the **first** strategy registration of each `setupSaml()` call (i.e. the regular `saml` strategy, not the `samlAdmin` follow-up):
   ```js
   if (!verifyCallback) {
     verifyCallback = verify;
     samlOptions = options;
   }
   ```
2. `samlOptions = null;` in the existing `beforeEach`, mirroring the existing `verifyCallback = null;` reset.
3. Three new `it(...)` blocks inside `describe('setupSaml', …)`:
   - `should not set disableRequestedAuthnContext or authnContext by default` — with no env vars, both keys are absent on the captured options.
   - `should set disableRequestedAuthnContext when SAML_DISABLE_REQUESTED_AUTHN_CONTEXT=true` — sets the env var, re-runs `setupSaml()`, asserts `samlOptions.disableRequestedAuthnContext === true`.
   - `should parse SAML_AUTHN_CONTEXT into a trimmed array of class refs` — sets a comma-separated value with whitespace, asserts `samlOptions.authnContext` equals the trimmed array.

