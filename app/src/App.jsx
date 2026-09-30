/* __imports_rewritten__ */
import React from 'react';
import { AppShell } from './components/AppShell.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { OrdersPage } from './pages/OrdersPage.jsx';
import { CallsPage } from './pages/CallsPage.jsx';
import { BillingPage } from './pages/BillingPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { OnboardingPage } from './pages/OnboardingPage.jsx';
import { InboxPage } from './pages/InboxPage.jsx';
import { CustomersPage } from './pages/CustomersPage.jsx';
import { AnalyticsPage } from './pages/AnalyticsPage.jsx';
import { hashRoute } from './utils.jsx';
import { useStore } from './store.jsx';
import { apiClient } from './api/client.js';

const routes = {
  '/dashboard': DashboardPage,
  '/inbox': InboxPage,
  '/customers': CustomersPage,
  '/analytics': AnalyticsPage,
  '/orders': OrdersPage,
  '/calls': CallsPage,
  '/billing': BillingPage,
  '/settings': SettingsPage,
  '/onboarding': OnboardingPage
};

export function App() {
  const [route, setRoute] = React.useState(hashRoute());
  const { state, dispatch } = useStore();

  React.useEffect(() => {
    // 1. Detect ?token= in window.location.search (from Shopify OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
      localStorage.setItem('dial-mate-token', token);
      console.log('✅ [AUTH] Captured Shopify JWT token and saved to localStorage');

      // Remove token query parameter from URL and set route to dashboard
      const cleanUrl = window.location.origin + window.location.pathname + '#/dashboard';
      window.history.replaceState({}, document.title, cleanUrl);
      window.location.hash = '/dashboard';
      setRoute('/dashboard');
    } else if (!window.location.hash) {
      const existingToken = localStorage.getItem('dial-mate-token');
      window.location.hash = existingToken ? '/dashboard' : '/onboarding';
    }

    const onHashChange = () => setRoute(hashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  React.useEffect(() => {
    async function loadFeatures() {
      try {
        const config = await apiClient.get('/features');
        if (config) {
          dispatch({ type: 'SET_FEATURES', features: config.features });
        }
      } catch (err) {
        console.error('Failed to load features:', err);
      }
    }
    loadFeatures();
  }, [state.backendUrl, dispatch]);

  const Page = routes[route] || DashboardPage;

  return (<AppShell route={route}><Page /></AppShell>);
}