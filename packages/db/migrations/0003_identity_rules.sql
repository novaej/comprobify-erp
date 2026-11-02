-- Rules for the identity tables Better Auth manages (ADR-009).

ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('es', 'en'));
--> statement-breakpoint

-- Emails are compared lower-cased; Better Auth stores them that way.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase_check CHECK (email = lower(email));
--> statement-breakpoint

CREATE FUNCTION public.app_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_touch_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER accounts_touch_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER verifications_touch_updated_at BEFORE UPDATE ON verifications
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint

-- These rows are credentials and counters, not business records: sign-out,
-- revocation, used tokens and old rate-limit hits are deleted. No other
-- application table gets DELETE.
GRANT DELETE ON sessions, verifications, rate_limit_hits TO comprobify_erp_app;
