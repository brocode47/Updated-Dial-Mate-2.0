export const apiClient = {
  baseUrl: import.meta.env.VITE_API_URL || '',

  getBackendUrl() {
    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '');
    }
    if (typeof window !== 'undefined' && window.location) {
      const { protocol, hostname, port } = window.location;
      // If frontend runs on Vite dev port 5173 or another frontend port, backend is on 8787
      if (port === '5173' || (port && port !== '8787')) {
        return `${protocol}//${hostname}:8787`;
      }
      return `${protocol}//${hostname}${port ? ':' + port : ''}`;
    }
    return 'http://localhost:8787';
  },

  getBaseUrl() {
    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL.replace(/\/$/, '');
    }
    return `${this.getBackendUrl()}/api`;
  },

  getShopifyAuthUrl(shopDomain) {
    const backend = this.getBackendUrl();
    const clean = String(shopDomain || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/\/$/, '');
    return `${backend}/auth/shopify?shop=${encodeURIComponent(clean)}`;
  },

  async request(endpoint, options = {}) {
    const token = localStorage.getItem('dial-mate-token');

    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const baseUrl = this.getBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = `${baseUrl}${cleanEndpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        console.warn('⚠️ [AUTH] 401 Unauthorized received. Clearing token.');
        localStorage.removeItem('dial-mate-token');
        if (typeof window !== 'undefined' && window.location.hash !== '#/onboarding') {
          window.location.hash = '/onboarding';
        }
        throw new Error('Session expired or unauthorized. Please reconnect your store.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (_) {
          errorData = { error: errorText };
        }
        throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
      }

      return response.json();
    } catch (err) {
      throw err;
    }
  },

  get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  },

  post(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) });
  },

  put(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) });
  },

  patch(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) });
  },

  delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  },

  logout() {
    localStorage.removeItem('dial-mate-token');
    if (typeof window !== 'undefined') {
      window.location.hash = '/onboarding';
      window.location.reload();
    }
  }
};
