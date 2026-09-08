export {};

type SupplierMatchFirebaseUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

type SupplierMatchFirebase = {
  signInWithGoogle: () => Promise<{ user: SupplierMatchFirebaseUser }>;
  subscribeToAuth: (callback: (user: SupplierMatchFirebaseUser | null) => void) => () => void;
  signOutUser: () => Promise<void>;
};

declare global {
  interface Window {
    supplierMatchFirebase?: SupplierMatchFirebase;
  }
}
