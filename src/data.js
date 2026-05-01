export function createInitialState() {
  return {
    session: {
      user: {
        name: 'Store Owner',
        email: 'owner@example.com',
        role: 'Owner'
      },
      shop: {
        name: 'Your Store',
        domain: 'bro-code-7492.myshopify.com',
        plan: 'Starter',
        language: 'Urdu First'
      }
    },

    branding: {
      logoDataUrl: null
    },

    voice: {
      voiceId: 'urdu_female_v3'
    },

    scripts: {
      confirmationUrdu:
        'Assalam o Alaikum ${CUSTOMER_NAME}. Aap ne ${PRODUCT_NAME} order kiya hai. Iski qeemat ${PRODUCT_PRICE} rupay hai. Tasdeeq ke liye 1 dabayein. Cancel karne ke liye 2 dabayein.',
      cancellationUrdu:
        'Aapka order cancel kar diya gaya hai. Shukriya.'
    },

    theme: 'light',

    billing: {
      currentPlan: 'Starter',
      monthlySpend: 0,
      voiceMinutes: 0,
      teamSeats: 1,
      freeTrialDaysLeft: 7,
      addons: []
    },

    analytics: {
      callsToday: 0,
      connectionRate: 0,
      confirmations: 0,
      recoveredRevenue: 0,
      fraudPrevented: 0,
      avgHandleTime: '00:00'
    },

    products: [],

    faqs: [
      {
        id: 'faq-1',
        question: 'Dial Mate kya karta hai?',
        answer:
          'Dial Mate Shopify orders ke liye automatic Urdu confirmation calls karta hai.'
      },
      {
        id: 'faq-2',
        question: 'Customer order kaise confirm karta hai?',
        answer:
          'Customer call par 1 press karta hai confirm ke liye, aur 2 press karta hai cancel ke liye.'
      },
      {
        id: 'faq-3',
        question: 'Kya calls retry hoti hain?',
        answer:
          'Ji, failed ya no-answer calls retry system ke through dobara attempt ho sakti hain.'
      }
    ],

    orders: [],

    calls: [],

    team: [
      {
        id: 'team-1',
        name: 'Store Owner',
        role: 'Owner',
        status: 'Active'
      }
    ],

    onboarding: {
      connectedShopify: false,
      syncedProducts: 0,
      syncedPolicies: false,
      voiceConfigured: true,
      widgetInstalled: false,
      webhooksActive: false
    },

    complianceLogs: [
      {
        id: 'log-1',
        event: 'System initialized',
        detail: 'Dial Mate is ready for Shopify connection',
        time: new Date().toLocaleTimeString()
      }
    ],

    backendUrl: 'https://leisa-celebrated-indefectibly.ngrok-free.dev'
  };
}