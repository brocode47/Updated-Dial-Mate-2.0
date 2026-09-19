import { CheckCircle2, Code, PhoneCall, ShoppingBag } from 'lucide-react?deps=react';
import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';

export function WidgetPreview() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const snippet = `<div data-dial-mate-widget="confirm"></div>
<script src="https://your-domain.com/widget.js"></script>);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      pushToast('Widget snippet copied.', 'success');
    } catch (err) {
      pushToast('Could not copy snippet.', 'error');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-3xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,hsla(var(--secondary),1),hsla(var(--primary),0.9))] p-5 text-white shadow-medium sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
            <ShoppingBag size={20} />
          </div>

          <div>
            <div className="text-lg font-semibold">Storefront confirmation notice</div>
            <div className="text-sm text-white/75">
              Optional widget for thank-you pages and order status pages.
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl bg-white/10 p-5 backdrop-blur">
          <div className="text-sm text-white/75">Customer message preview</div>

          <div className="mt-3 text-2xl font-semibold leading-tight">
            Aap ke order ki tasdeeq call se ki jayegi
          </div>

          <div className="mt-2 text-sm leading-6 text-white/82">
            Dial Mate aapko Urdu mein call karega. Order confirm karne ke liye 1 dabayein,
            cancel karne ke liye 2 dabayein.
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-medium">Urdu IVR</span>
            <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-medium">1 Confirm</span>
            <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-medium">2 Cancel</span>
          </div>
        </div>
      </div>

      <div className="soft-card rounded-3xl p-5 shadow-soft sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <Code size={18} />
          </div>

          <div>
            <div className="font-semibold">Optional widget</div>
            <div className="text-sm text-[hsl(var(--foreground)/0.66)]">
              Use after widget script is deployed.
            </div>
          </div>
        </div>

        <pre className="mt-4 overflow-auto rounded-2xl bg-[hsl(var(--secondary))] p-4 text-xs leading-5 text-white">
{snippet}
        </pre>

        <div className="mt-4 grid gap-2">
          <button
            onClick={copySnippet}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold"
          >
            <Code size={16} />
            Copy snippet
          </button>

          <button
            onClick={() => {
              dispatch({ type: 'INSTALL_WIDGET' });
              pushToast('Widget marked as installed.', 'success');
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white"
          >
            {state.onboarding.widgetInstalled
              ? (<CheckCircle2 size={16} /> Widget installed : (<PhoneCall size={16} /> Mark as installed}
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-amber-500/12 p-4 text-sm text-amber-700">
          This widget is optional. The main order calling system works without it.
        </div>
      </div>
    </div>
  );
}