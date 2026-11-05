import { AppToastHost } from './components/common/AppToast';
import { HomeShell } from './components/home/HomeShell';
import './App.css';

export default function App() {
  return (
    <>
      <HomeShell />
      <AppToastHost />
    </>
  );
}
