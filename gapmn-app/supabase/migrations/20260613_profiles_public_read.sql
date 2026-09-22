-- Permite que todos os usuários autenticados vejam todos os perfis
-- (necessário para dropdowns de seleção de usuário em todo o app)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile."  ON profiles;
DROP POLICY IF EXISTS "profiles_select_own"               ON profiles;
DROP POLICY IF EXISTS "profiles_public_read"              ON profiles;

CREATE POLICY "profiles_public_read"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- UPDATE: cada usuário pode editar o próprio perfil; ADMIN/DEV editam qualquer um
DROP POLICY IF EXISTS "profiles_update_own"  ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile." ON profiles;

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.setor IN ('ADMIN','DEV'))
  );
