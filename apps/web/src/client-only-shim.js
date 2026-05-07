// No-op shim for "client-only" RSC guard module.
// In standalone mode, @supernote/* and @heroui/* pre-built dist files import
// "client-only" without "use client" directives. This shim replaces the
// react-server export of client-only (which throws) with a silent no-op,
// applied only to the RSC/Node.js webpack compilation layer.
