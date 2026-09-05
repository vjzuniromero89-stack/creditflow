// Cliente ligero para hablar con el backend del Worker de Cloudflare bajo /api/*.
async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message = (data && data.error) || `Error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function upload(path, formData) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data && data.error) || `Error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body || {}),
  put: (path, body) => request("PUT", path, body || {}),
  del: (path) => request("DELETE", path),
  upload: (path, formData) => upload(path, formData),
};
