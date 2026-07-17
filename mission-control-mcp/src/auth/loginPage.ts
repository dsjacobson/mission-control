interface LoginPageParams {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope?: string;
  resource?: string;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A minimal, dependency-free HTML consent screen. It posts to /login (not the SDK's
 * /authorize route) because the OAuthServerProvider.authorize() callback only receives
 * the parsed authorization params and an Express response, not the raw request body,
 * so there's nowhere in that callback to read a submitted password from. /login is a
 * plain route we add ourselves that has full access to req.body.
 */
export function renderLoginPage(params: LoginPageParams): string {
  const hidden = (name: string, value: string | undefined) =>
    value ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connect to Mission Control</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #0b0b0d; color: #eaeaea;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #17171a; border: 1px solid #2a2a2e; border-radius: 12px; padding: 32px;
            width: 100%; max-width: 380px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p { color: #9a9a9e; font-size: 14px; line-height: 1.5; }
    .detail { background: #0b0b0d; border: 1px solid #2a2a2e; border-radius: 8px; padding: 12px 14px;
               font-size: 13px; margin: 16px 0; word-break: break-all; }
    label { display: block; font-size: 13px; margin: 16px 0 6px; }
    input[type="password"] { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
            border: 1px solid #3a3a3e; background: #0b0b0d; color: #eaeaea; font-size: 14px; }
    button { width: 100%; margin-top: 20px; padding: 10px 12px; border-radius: 8px; border: none;
             background: #eaeaea; color: #0b0b0d; font-size: 14px; font-weight: 600; cursor: pointer; }
    .error { color: #ff6b6b; font-size: 13px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to Mission Control</h1>
    <p><strong>${escapeHtml(params.clientName)}</strong> wants to access your Mission Control workspace.</p>
    <div class="detail">Redirects to: ${escapeHtml(params.redirectUri)}</div>
    ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ''}
    <form method="POST" action="/login">
      ${hidden('client_id', params.clientId)}
      ${hidden('redirect_uri', params.redirectUri)}
      ${hidden('state', params.state)}
      ${hidden('code_challenge', params.codeChallenge)}
      ${hidden('scope', params.scope)}
      ${hidden('resource', params.resource)}
      <label for="password">Dashboard password</label>
      <input type="password" id="password" name="password" autofocus required />
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}
