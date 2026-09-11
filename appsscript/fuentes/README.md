# Conexión privada de las tres planillas

El puente lee costos, central de atención y gestión con la cuenta que lo instala.
Las planillas permanecen privadas. El endpoint se autentica mediante un token
guardado en el servidor; el navegador del tablero nunca lo recibe.

La arquitectura, cobertura y secuencia de activación están en
[GESTION-MENSUAL.md](../../GESTION-MENSUAL.md). La implementación está preparada
localmente; no confundir una prueba local con una conexión remota activa.

## Instalar después de autorizar la publicación

```sh
npx @google/clasp@2.4.2 login
npm run instalar-puente
# Si el proyecto ya existe:
npm run instalar-puente -- --actualizar
```

El instalador inyecta COSTOS_ID, CENTRAL_ID, GESTION_ID y TOKEN en una copia del
código. Los secretos quedan en `.naku-puente.json`, ignorado por git.
La sesión debe pertenecer a la cuenta con acceso de lectura a los tres documentos.

En Google, ejecutar `probar` y autorizar los permisos declarados en
`appsscript.json`: Sheets/Drive de lectura, llamadas externas y gestión del
disparador de este script. Verificar las tres fuentes, no sólo el ping del endpoint.

Para un Google Sheet se leen valores y fórmulas. Para un XLSX en Drive se consulta
el MIME y `capabilities.canDownload` y se envía el archivo al servidor para leerlo.
El proceso no convierte ni modifica archivos en Drive. El límite del lector XLSX
es de 30 MB; una restricción del propietario se respeta y se informa como error.

## Conectar al servidor y programar

1. Configurar `NAKU_FUENTES_URL` (URL `/exec`) y `NAKU_FUENTES_TOKEN` como secretos
   de la función Buyer. La llamada habitual usa POST, sin token en la URL.
2. Configurar en Propiedades del script `API_URL` (función Buyer, sin barra final)
   y `API_CLAVE` (clave financiera).
3. Ejecutar `instalarSincronizacion`: crea el disparador cada hora. Si ya existe,
   reemplaza sólo ese disparador.
4. Ejecutar `sincronizarProgramado` y comprobar la vista mensual, la conciliación
   y la fecha de actualización del tablero. Después verificar una ejecución horaria.

El botón **Sincronizar las tres planillas** llama al mismo endpoint del servidor.
`ULTIMA_SINCRONIZACION` y `ERROR_SINCRONIZACION` quedan en Propiedades del script.
Los errores conservan los últimos datos guardados. Google registra las ejecuciones
automáticas en el proyecto; el tablero muestra su última versión válida.

Para comprobar sin publicar datos, con el puente ya autorizado:

```sh
npm run actualizar -- --google --sin-publicar
```

La activación exige renovar una autorización Google vencida. Un acceso lector
al archivo en el navegador no significa que la cuenta del script ya esté autorizada.
