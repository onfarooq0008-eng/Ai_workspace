// Entry point: all modules above are plain scripts sharing one global scope; this just boots the session.
const _origRenderOffice = renderOfficeRoom;
renderOfficeRoom = function () { _origRenderOffice(); officeSyncSnapshot(); };
checkSession();
