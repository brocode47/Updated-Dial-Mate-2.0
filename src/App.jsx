/* __imports_rewritten__ */
import React from 'react';
import { AppShell } from './components/AppShell.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { OrdersPage } from './pages/OrdersPage.jsx';
import { CallsPage } from './pages/CallsPage.jsx';
import { BillingPage } from './pages/BillingPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { OnboardingPage } from './pages/OnboardingPage.jsx';
import { hashRoute } from './utils.jsx';
import { useStore } from './store.jsx';

const routes = {
  '/dashboard': DashboardPage,
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
    const onHashChange = () => setRoute(hashRoute());
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      window.location.hash = '/onboarding';
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  React.useEffect(() => {
    async function loadFeatures() {
      try {
        const res = await fetch(`${state.backendUrl}/api/features`);
        if (res.ok) {
          const config = await res.json();
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