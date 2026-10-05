export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'\"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] as string,
  );
}

export function page(content: string, title: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{background:#f7f8fc;color:#172033;font:16px/1.5 system-ui,sans-serif;margin:0}main{background:#fff;border:1px solid #dde1eb;border-radius:16px;box-shadow:0 8px 32px #17203312;max-width:720px;margin:8vh auto;padding:32px}h1{margin-top:0}code,dd{overflow-wrap:anywhere}dt{color:#536079;font-weight:600;margin-top:16px}dd{margin:2px 0}.button{background:#235bd8;border-radius:8px;color:#fff;display:inline-block;padding:9px 14px;text-decoration:none}.error{color:#a32626}img{border-radius:50%;height:64px;object-fit:cover;width:64px}</style><main><h1>${escapeHtml(title)}</h1>${content}</main></html>`;
}
