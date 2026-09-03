# Puente de fuentes — instalación

Un Apps Script que le pasa al tablero los datos de las dos planillas que **no se
pueden compartir**: la de compras (tiene los costos) y la de la central de
atención (tiene datos de clientes).

Se implementa **ejecutándose como vos**, así que lee las planillas con tu propio
acceso. Nadie más las ve. Afuera queda una URL con token que devuelve nada más
que las columnas que el tablero usa — ni teléfonos, ni direcciones, ni nombres.

## La forma corta: dos comandos

```bash
npx @google/clasp@2.4.2 login     # una vez: abre el navegador, entrás con tu cuenta
npm run instalar-puente
```

El segundo hace todo lo demás: genera el token, crea el proyecto, sube el código,
lo publica como aplicación web configurada para correr con **tu** cuenta, prueba
que responda y te deja las dos líneas para pegar en `~/.zshrc`.

Dos cosas pueden pedirte una vuelta más, y el propio comando te dice cuál:

- **"La API de Apps Script está apagada"** → abrís
  [script.google.com/home/usersettings](https://script.google.com/home/usersettings),
  la ponés en *Activado*, y volvés a correr el comando. Es un interruptor, una vez.
- **"Está publicado pero todavía no contesta"** → falta autorizar los permisos.
  Abrís el proyecto, ejecutás la función `probar` y aceptás. Google va a decir
  "no verificada": es tu propio script, entrás por *Configuración avanzada*.

Ese último paso es el único que no se puede automatizar, y es a propósito: el
script lee tus planillas con tu acceso, así que Google exige que la autorización
la des vos. Es justamente lo que evita tener que compartirlas con nadie.

Para subir cambios más adelante: `npm run instalar-puente -- --actualizar`.

---

## La forma larga (a mano, si preferís ver cada paso)

1. **[script.google.com](https://script.google.com) → Nuevo proyecto.** Nombralo
   *Naku · Fuentes del tablero*.

2. **Pegá `Codigo.gs`** en el archivo que viene por defecto.

3. **Completá `CONFIG`** arriba de todo:

   ```js
   const CONFIG = {
     COSTOS_ID:  '1XQeYyMcS9LRv2wXmbsf_9hYj0o2vrrJU',
     CENTRAL_ID: '1Of9JnLdQu3y4wrAoIU26mjxGk1nIHwewamsIdfHiej0',
     TOKEN:      '',   // ← inventá uno largo y al azar
   };
   ```

   Para el token sirve cualquier cosa larga; por ejemplo, en una terminal:
   `openssl rand -hex 24`

4. **Ejecutá `probar`** (el desplegable de arriba → `probar` → Ejecutar). Google
   va a pedir permisos la primera vez: aceptá. En *Registro de ejecución* tenés
   que ver algo así:

   ```
   ✓ token configurado (48 caracteres)
   ✓ costos: hoja "JULIO 2026" (2026-07) — 189 SKU con costo
   ✓ central: 858 casos de postventa, 735 de preventa minorista, 0 de volumen
   ```

   Si alguna línea dice ✗, el mensaje explica qué falta.

5. **Implementar → Nueva implementación → Aplicación web:**

   | | |
   |---|---|
   | Ejecutar como | **Yo** |
   | Quién tiene acceso | **Cualquier persona** |

   "Cualquier persona" suena mal pero es lo correcto: sin eso, sólo funciona
   desde el navegador con tu sesión abierta. Lo que protege es el token, y la
   URL no está publicada en ningún lado.

   Copiá la URL que termina en `/exec`.

6. **Conectalo.** En la computadora donde corrés el tablero:

   ```bash
   export NAKU_FUENTES_URL="https://script.google.com/macros/s/…/exec"
   export NAKU_FUENTES_TOKEN="el token que inventaste"
   ```

   Para que queden fijas, agregalas al final de `~/.zshrc`. También pueden ir en
   `naku.config.json` → `"fuentes"`, pero ahí quedan versionadas en el repo.

## Probar que quedó bien

```bash
npm run tablero
```

La primera línea tiene que decir:

```
· puente: costos de "JULIO 2026" (189 SKU) · central con 858 casos
```

Si en cambio avisa que el puente no está disponible, sigue con los archivos
locales y el mensaje dice qué pasó.

## Qué sale por la URL y qué no

| Sale | No sale |
|---|---|
| SKU y su costo sin IVA | Precios de lista, proveedores, todo el resto de la planilla de compras |
| Caso, fecha, urgencia, tipo de reclamo, SKU, estatus, responsable | Nombre del cliente, teléfono, mensaje, fotos, ID de venta |

Las columnas están declaradas en `CAMPOS_POSTVENTA`, `CAMPOS_MINORISTA` y
`CAMPOS_VOLUMEN` al principio del script. Lo que no esté ahí no viaja.

## Si cambiás el código

Hay que volver a implementar: **Implementar → Gestionar implementaciones →
(lápiz) → Versión: Nueva**. Si no, sigue corriendo la versión vieja y parece que
el cambio no tuvo efecto.
