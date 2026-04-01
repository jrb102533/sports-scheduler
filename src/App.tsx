import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from './store/useAuthStore';
import { ForcePasswordChangeModal } from './components/auth/ForcePasswordChangeModal';
import { ConsentUpdateModal } from './components/auth/ConsentUpdateModal';

export default function App() {
  const isAuthenticated = useAuthStore(s => Boolean(s.user));
  const mustChangePassword = useAuthStore(s => s.mustChangePassword);
  const consentOutdated = useAuthStore(s => s.consentOutdated);

  useEffect(() => {
    const unsubscribe = useAuthStore.getState().init();
    return unsubscribe;
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      {isAuthenticated && mustChangePassword && <ForcePasswordChangeModal />}
      {isAuthenticated && !mustChangePassword && consentOutdated && <ConsentUpdateModal />}
    </>
  );
}
