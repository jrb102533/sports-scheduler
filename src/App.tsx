import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from './store/useAuthStore';
import { ForcePasswordChangeModal } from './components/auth/ForcePasswordChangeModal';
import { ConsentUpdateModal } from './components/auth/ConsentUpdateModal';

export default function App() {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const init = useAuthStore(s => s.init);
  const user = useAuthStore(s => s.user);
  const mustChangePassword = useAuthStore(s => s.mustChangePassword);
  const consentOutdated = useAuthStore(s => s.consentOutdated);

  useEffect(() => {
    return init();
  // init is a stable store action — intentionally omitted from deps to avoid
  // re-subscribing the auth listener on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      {user && mustChangePassword && <ForcePasswordChangeModal />}
      {user && !mustChangePassword && consentOutdated && <ConsentUpdateModal />}
    </>
  );
}
