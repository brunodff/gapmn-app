const { data, error } = await supabase.auth.signUp({
  email: email.trim().toLowerCase(),
  password: senha,
  options: {
    emailRedirectTo: "https://gapmn.app/auth/confirm",
  },
});
