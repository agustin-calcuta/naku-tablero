# Ventas compartidas entre Buyer y Finanzas

Desde septiembre de 2026, los exports de MeLi/TN cargados desde cualquiera de
los tableros alimentan ambos. Buyer publica al procesar. Finanzas conserva la
vista previa y el botón de publicación. Ambos consultan cambios cada 30 segundos
y al recuperar el foco.

Los costos y la central sólo se actualizan desde Finanzas. El servidor conserva
la última planilla de costos para las siguientes cargas. El maestro de Buyer
acepta `,` y `;`, BOM, comillas y saltos de línea dentro de celdas. Las filas
nuevas se agregan y los SKU corregidos reemplazan su mapeo en todo el histórico.

## Datos y concurrencia

- `src/ventas-compartidas.mjs` conserva órdenes completas, incluyendo cabecera
  e hijos de los paquetes de ML y los productos adicionales de TN. Una orden
  superpuesta se reemplaza con el último export cargado; nunca se suma dos veces.
- Sólo se guardan las columnas de ventas que consumen los motores. Se omiten
  nombres de clientes, direcciones, emails, teléfonos y documentos.
- Las fuentes, costos y central permanecen en el servidor. La API de Buyer sólo
  devuelve sus líneas normalizadas y maestro; no devuelve costos ni Finanzas.
- `neon/buyer/handler.mjs` recalcula ambos resultados con los mismos motores que
  usan los builds. `buyer_guardar` confirma fuentes, Buyer y Finanzas en una sola
  transacción, con control de revisión y reintentos ante cargas concurrentes.
- Las operaciones tienen un identificador para resolver reintentos sin duplicar.
  Un maestro basado en una revisión vieja se rechaza para que el usuario revise
  la versión actual. Se conservan las últimas 10 versiones de Buyer y fuentes,
  y las últimas 30 publicaciones financieras.
- El endpoint financiero anterior permite lecturas; rechaza publicaciones de
  pestañas antiguas que intentarían guardar un snapshot sin sus fuentes.

La clave financiera existente permite operar ambos tableros. La clave propia
del Buyer permite cargar ventas y maestro, pero no leer el tablero financiero ni
editar costos/central. Nunca se guardan claves en el repositorio.

## Histórico anterior

Se inicializa Buyer con su histórico base más los exports ya usados en el último
Finanzas. La migración compara todos los bloques financieros antes de habilitarse.
Los datos existentes en IndexedDB se conservan; el botón **Compartir histórico de
este navegador** incorpora los faltantes sin sobrescribir órdenes de las fuentes
compartidas. Si hay maestro local, la confirmación informa que también lo aplica.

Las líneas antiguas que no tienen export original sólo completan Buyer: les
faltan los cargos e importes necesarios para Finanzas. Re-subir el export original
las incorpora a ambos. El maestro adjunto por Leo no se aplica durante la
migración; lo puede subir desde la interfaz.

## Construcción y despliegue

```sh
node tools/build-tablero.mjs
npm test
# Pruebas con una rama Neon aislada, nunca con producción:
NAKU_TEST_BRANCH=<rama-de-pruebas> node tools/test-shared.mjs

# Preparar y comparar la migración inicial (archivos en Downloads):
node tools/prepare-shared.mjs
# Aplica DDL, inicializa sólo si está vacío y despliega las dos funciones:
node tools/deploy-shared.mjs
```

`docs/nueva.html` y `docs/ventas-shared.js` se generan con `build-tablero.mjs`.
`docs/direccion.html` y `docs/importar-ui.js` son las fuentes de la interfaz
financiera. Publicarlos en la rama de GitHub Pages después de desplegar la API.
La conexión de Neon se obtiene del CLI autenticado, sin imprimir credenciales.
El acceso de Leo se escribe en `.backup/shared/acceso-buyer.txt`, ignorado por git.

La planilla inicial de costos es JULIO 2026, igual que la última publicación
financiera. Subir ventas nuevas no inventa costos nuevos ni cambia la fecha de
esa planilla; la cobertura de costos sigue mostrándose en Finanzas.
