import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    mfaPending?: boolean;
    mfaEnabled?: boolean;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      mfaPending?: boolean;
      mfaEnabled?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    mfaPending?: boolean;
    mfaEnabled?: boolean;
  }
}
