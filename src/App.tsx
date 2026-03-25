import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from './store/useAuthStore';
import { ForcePasswordChangeModal } from './components/auth/ForcePasswordChangeModal';

export default function App() {
  const init = useAuthStore(s => s.init);
  const user = useAuthStore(s => s.user);
  const mustChangePassword = useAuthStore(s => s.mustChangePassword);

  useEffect(() => {
    const unsubscribe = init();
    return unsubscribe;
  }, [init]);

  return (
    <>
      <RouterProvider router={router} />
      {user && mustChangePassword && <ForcePasswordChangeModal />}
    </>
  );
}
