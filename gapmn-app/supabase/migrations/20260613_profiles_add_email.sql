-- Adiciona coluna email em profiles e preenche a partir de auth.users
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill: copia email de auth.users para profiles existentes
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL;

-- Trigger: mantém profiles.email sincronizado quando auth.users é atualizado
CREATE OR REPLACE FUNCTION sync_profile_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_email ON auth.users;
CREATE TRIGGER trg_sync_profile_email
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_profile_email();
