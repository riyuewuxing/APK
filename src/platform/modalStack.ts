export type ModalCloser = () => void;

interface ModalStackEntry {
  id: string;
  close: ModalCloser;
}

const modalStack: ModalStackEntry[] = [];

export const ROOT_TAB_PATHS = new Set<string>([
  '/',
  '/expert',
  '/expert-radar',
  '/watchlist',
]);

export function registerModalCloser(id: string, close: ModalCloser): () => void {
  const existingIndex = modalStack.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) {
    modalStack.splice(existingIndex, 1);
  }
  modalStack.push({ id, close });

  return () => {
    const idx = modalStack.findIndex((entry) => entry.id === id);
    if (idx >= 0) {
      modalStack.splice(idx, 1);
    }
  };
}

export function closeTopModal(): boolean {
  const top = modalStack.pop();
  if (!top) {
    return false;
  }
  top.close();
  return true;
}

export function isRootTabRoute(pathname: string, search = ''): boolean {
  if (!ROOT_TAB_PATHS.has(pathname)) {
    return false;
  }
  // 专家工作台带标的参数时视为子视图，右滑优先退回默认工作台
  if (pathname === '/expert' && search.includes('symbol=')) {
    return false;
  }
  return true;
}

export function clearModalStackForTest(): void {
  modalStack.length = 0;
}
