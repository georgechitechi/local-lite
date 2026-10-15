/**
 * User management utilities for edge functions
 */

export const placeholderEmails = ['placeholder'];

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return placeholderEmails.some(ph => email.toLowerCase().startsWith(ph));
}

/**
 * Find or create the admin user in the destination database
 * All source user IDs will be mapped to this single admin user
 */
export async function getOrCreateAdminUser(
  destSupabase: any,
  adminEmail: string,
): Promise<{ id: string; email: string }> {
  console.log(`🎯 Looking for admin user: ${adminEmail}`);

  // Find or create the admin user
  const { data: usersList, error: listError } = await destSupabase.auth.admin.listUsers();

  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`);
  }

  let adminUser = usersList.users.find((u: any) => u.email === adminEmail);

  if (!adminUser) {
    // Admin user doesn't exist, create it
    console.log(`👤 Creating admin user: ${adminEmail}...`);

    const { data: newUser, error: createError } =
      await destSupabase.auth.admin.createUser({
        email: adminEmail,
        password: crypto.randomUUID(), // Random secure password
        email_confirm: true, // Auto-confirm email
      });

    if (createError) {
      throw new Error(`Cannot create admin user ${adminEmail}: ${createError.message}`);
    }

    adminUser = newUser.user;
    console.log(`✅ Created admin user: ${adminEmail} (${adminUser.id})`);
  } else {
    console.log(`✅ Found admin user: ${adminEmail} (${adminUser.id})`);
  }

  return {
    id: adminUser.id,
    email: adminUser.email,
  };
}

/**
 * Create user mapping from source user IDs to destination admin user
 * All source users will be mapped to a single admin user
 */
export function createUserMapping(
  sourceUserIds: Set<string>,
  adminUserId: string,
  adminEmail: string,
): Record<string, string> {
  const userMapping: Record<string, string> = {};

  for (const sourceUserId of sourceUserIds) {
    userMapping[sourceUserId] = adminUserId;
    console.log(`✅ Mapped ${sourceUserId} → ${adminUserId} (${adminEmail})`);
  }

  // Add default mapping to catch any unsampled user IDs
  userMapping.__default__ = adminUserId;

  console.log(
    `✅ User mapping complete: ${Object.keys(userMapping).length} source users → 1 admin user`,
  );

  return userMapping;
}
