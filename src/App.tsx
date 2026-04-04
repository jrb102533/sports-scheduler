import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from './store/useAuthStore';
import { ForcePasswordChangeModal } from './components/auth/ForcePasswordChangeModal';
import { ConsentUpdateModal } from './components/auth/ConsentUpdateModal';

export default function App() {
  const user = useAuthStore(s => s.user);
  const mustChangePassword = useAuthStore(s => s.mustChangePassword);
  const consentOutdated = useAuthStore(s => s.consentOutdated);

  useEffect(() => {
    return useAuthStore.getState().init();
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      {user && mustChangePassword && <ForcePasswordChangeModal />}
      {user && !mustChangePassword && consentOutdated && <ConsentUpdateModal />}
    </>
  );
}
