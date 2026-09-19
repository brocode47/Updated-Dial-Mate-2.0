import React from 'react';
import { createInitialState } from './data.jsx';

const StoreContext = React.createContext(null);

const STORAGE_KEY = 'dial-mate-state-v2';
const LEGACY_STORAGE_KEY = 'dial-mate-state';
const OLD_LEGACY_STORAGE_KEY = 'zariya-confirm-state';

function getDefaultBackendUrl() {
  return 'https://leisa-celebrated-indefectibly.ngrok-free.dev';
}

function normalizeBackendUrl(url) {
  return String(url || getDefaultBackendUrl()).trim().replace(/\/$/, '');
}

function normalizeShopDomain(domain) {
  const cleaned = String(domain || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  if (!cleaned) return '';

  return cleaned.endsWith('.myshopify.com')
    ? cleaned
    : `${cleaned}.myshopify.com`;
}

function mergeState(base, parsed) {
  return {
    ...base,
    ...parsed,

    session: {
      ...base.session,
      ...(parsed.session || {}),
      user: {
        ...base.session.user,
        ...(parsed.session?.user || {})
      },
      shop: {
        ...base.session.shop,
        ...(parsed.session?.shop || {}),
        domain: normalizeShopDomain(
          parsed.session?.shop?.domain || base.session.shop.domain
        )
      }
    },

    features: {
      ...base.features,
      ...(parsed.features || {})
    },

    branding: {
      ...base.branding,
      ...(parsed.branding || {})
    },

    voice: {
      ...base.voice,
      ...(parsed.voice || {})
    },

    scripts: {
      ...base.scripts,
      ...(parsed.scripts || {})
    },

    billing: {
      ...base.billing,
      ...(parsed.billing || {})
    },

    analytics: {
      ...base.analytics,
      ...(parsed.analytics || {})
    },

    onboarding: {
      ...base.onboarding,
      ...(parsed.onboarding || {})
    },

    products: Array.isArray(parsed.products) ? parsed.products : base.products,
    faqs: Array.isArray(parsed.faqs) ? parsed.faqs : base.faqs,
    orders: Array.isArray(parsed.orders) ? parsed.orders : base.orders,
    calls: Array.isArray(parsed.calls) ? parsed.calls : base.calls,
    team: Array.isArray(parsed.team) ? parsed.team : base.team,
    complianceLogs: Array.isArray(parsed.complianceLogs)
      ? parsed.complianceLogs
      : base.complianceLogs,

    backendUrl: normalizeBackendUrl(parsed.backendUrl || base.backendUrl)
  };
}

function loadState() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY) ||
      localStorage.getItem(OLD_LEGACY_STORAGE_KEY);

    const base = createInitialState();

    if (!raw) {
      return {
        ...base,
        backendUrl: normalizeBackendUrl(base.backendUrl)
      };
    }

    const parsed = JSON.parse(raw);
    return mergeState(base, parsed);
  } catch (error) {
    console.error('Failed to load saved app state:', error);
    return createInitialState();
  }
}

function persistState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save app state:', error);
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'TOGGLE_THEME': {
      return {
        ...state,
        theme: state.theme === 'light' ? 'dark' : 'light'
      };
    }

    case 'SET_BACKEND_URL': {
      return {
        ...state,
        backendUrl: normalizeBackendUrl(action.url || action.backendUrl)
      };
    }

    case 'SET_FEATURES': {
      return {
        ...state,
        features: {
          ...state.features,
          ...action.features
        }
      };
    }

    case 'SET_SHOP_DOMAIN': {
      return {
        ...state,
        session: {
          ...state.session,
          shop: {
            ...state.session.shop,
            domain: normalizeShopDomain(action.domain)
          }
        }
      };
    }

    case 'SET_SHOP_INFO': {
      return {
        ...state,
        session: {
          ...state.session,
          shop: {
            ...state.session.shop,
            ...action.shop,
            domain: normalizeShopDomain(action.shop?.domain || state.session.shop.domain)
          }
        }
      };
    }

    case 'SET_ONBOARDING_STATUS': {
      return {
        ...state,
        onboarding: {
          ...state.onboarding,
          ...action.onboarding
        }
      };
    }

    case 'SYNC_DATA': {
      const orders = Array.isArray(action.orders) ? action.orders : state.orders;
      const calls = Array.isArray(action.calls) ? action.calls : state.calls;
      const complianceLogs = Array.isArray(action.complianceLogs)
        ? action.complianceLogs
        : state.complianceLogs;

      return {
        ...state,
        orders,
        calls,
        complianceLogs,
        onboarding: {
          ...state.onboarding,
          connectedShopify: true,
          webhooksActive: true,
          syncedProducts: orders.length,
          voiceConfigured: true
        }
      };
    }

    case 'SET_ORDERS': {
      return {
        ...state,
        orders: Array.isArray(action.orders) ? action.orders : []
      };
    }

    case 'SET_CALLS': {
      return {
        ...state,
        calls: Array.isArray(action.calls) ? action.calls : []
      };
    }

    case 'SET_ROUTE_NOTE': {
      return {
        ...state,
        session: {
          ...state.session,
          routeNote: action.note
        }
      };
    }

    case 'UPDATE_ACCOUNT': {
      return {
        ...state,
        session: {
          ...state.session,
          user: {
            ...state.session.user,
            ...action.user
          }
        }
      };
    }

    case 'UPDATE_LOGO': {
      return {
        ...state,
        branding: {
          ...state.branding,
          logoDataUrl: action.logoDataUrl || null
        }
      };
    }

    case 'UPDATE_VOICE': {
      return {
        ...state,
        voice: {
          ...state.voice,
          voiceId: action.voiceId
        }
      };
    }

    case 'UPDATE_SCRIPT': {
      return {
        ...state,
        scripts: {
          ...state.scripts,
          [action.key]: action.value
        }
      };
    }

    case 'UPDATE_PLAN': {
      return {
        ...state,
        billing: {
          ...state.billing,
          currentPlan: action.plan
        },
        session: {
          ...state.session,
          shop: {
            ...state.session.shop,
            plan: action.plan
          }
        }
      };
    }

    case 'INSTALL_WIDGET': {
      return {
        ...state,
        onboarding: {
          ...state.onboarding,
          widgetInstalled: true
        }
      };
    }

    case 'RESET_LOCAL_DATA': {
      const fresh = createInitialState();
      return {
        ...fresh,
        backendUrl: normalizeBackendUrl(state.backendUrl || fresh.backendUrl),
        theme: state.theme
      };
    }

    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = React.useReducer(reducer, null, loadState);

  React.useEffect(() => {
    persistState(state);
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state]);

  const value = React.useMemo(
    () => ({
      state,
      dispatch,
      helpers: {
        normalizeBackendUrl,
        normalizeShopDomain
      }
    }),
    [state]
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = React.useContext(StoreContext);

  if (!context) {
    throw new Error('useStore must be used within StoreProvider');
  }

  return context;
}