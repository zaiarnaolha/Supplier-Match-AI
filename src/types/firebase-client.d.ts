export {};

type SupplierMatchFirebaseUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

type SupplierMatchSearchInput = {
  query: string;
  criteria: Record<string, unknown>;
};

type SupplierMatchFirebase = {
  signInWithGoogle: () => Promise<{ user: SupplierMatchFirebaseUser }>;
  subscribeToAuth: (callback: (user: SupplierMatchFirebaseUser | null) => void) => () => void;
  signOutUser: () => Promise<void>;
  ensureCurrentUser: () => Promise<void>;
  startSearch: (input: SupplierMatchSearchInput) => Promise<string | null>;
  completeSearch: (searchId: string | null, results: unknown[]) => Promise<void>;
  listSearches: () => Promise<Array<Record<string, unknown>>>;
};

declare global {
  interface Window {
    supplierMatchFirebase?: SupplierMatchFirebase;
  }
}
