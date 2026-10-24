-- La fonction qui crée le profil n'est appelée que par le déclencheur sur auth.users :
-- personne ne doit pouvoir l'appeler depuis l'API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
