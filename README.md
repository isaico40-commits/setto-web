# Setto · sitio web + panel del equipo

- **Sitio público** (`index.html`): edición especial, sets, carta, pedido de take away que se envía a WhatsApp con un código (STT-1234) y consulta de la tarjeta del Setto Club.
- **Panel del equipo** (`panel.html` o `/panel`): pedidos pendientes, botón "Entregado" que suma sellos, Club (sellos manuales y canje), carta con fotos, y ajustes.
- **Base de datos:** Supabase (plan gratis). **Hosting:** Vercel (plan gratis).

Sin las claves de Supabase, todo funciona en **modo demo**: los datos quedan guardados solo en el navegador. Sirve para probar el flujo antes de configurar nada.

---

> **Estado (13/10/2026):** los pasos 1, 2 y 3 ya están hechos. La base está instalada en el proyecto de Supabase `vqgfckswnqoekotmsyam` y `js/config.js` ya tiene la URL y la clave pública. Faltan el paso 4 (usuarios) y el 5 (publicar).

## Puesta en marcha (unos 20 minutos)

### 1. Crear la base en Supabase
1. Entrá a https://supabase.com, creá una cuenta y tocá **New project**.
2. Nombre: `setto`. Región: la más cercana (South America · São Paulo). Guardá la contraseña de la base en un lugar seguro.
3. Esperá que termine de crearse (1–2 minutos).

### 2. Cargar las tablas y la carta
1. En el proyecto, andá a **SQL Editor → New query**.
2. Abrí `supabase/schema.sql`, copiá **todo** el contenido, pegalo y tocá **Run**.
3. Tiene que decir *Success*. Este archivo crea las tablas, la seguridad, las funciones de pedidos y sellos, la carpeta de fotos y la carta de octubre. Si lo corrés de nuevo, no borra nada de lo que ya cargaste.

### 3. Conectar el sitio con la base
1. En Supabase andá a **Project Settings → API**.
2. Copiá **Project URL** y la key **anon public**.
3. Pegalas en `js/config.js`:
   ```js
   window.SETTO_CONFIG = {
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseAnonKey: "eyJhbGciOi..."
   };
   ```
   La key `anon` es pública: es normal que se vea en el navegador. La seguridad la dan las reglas de la base.
   **No pegues nunca la key `service_role`.**

### 4. Crear los usuarios del equipo (Isa, Alan, Lucas)
1. **Authentication → Users → Add user → Create new user**. Poné email y contraseña, y marcá *Auto Confirm User*.
2. Repetí para cada persona.
3. Habilitalos como equipo en **SQL Editor**, cambiando los emails:
   ```sql
   insert into public.staff (user_id, nombre)
   select id, 'Isa' from auth.users where email = 'isa@ejemplo.com'
   on conflict do nothing;
   ```
   (Uno por persona, cambiando el nombre y el email.)
4. Recomendado: en **Authentication → Providers/Sign In → Email**, desactivá que se pueda registrar gente nueva (*Allow new users to sign up*). Así nadie puede crearse una cuenta sola. Aunque alguien lo hiciera, sin estar en `staff` no ve ni toca nada.

### 5. Publicar en Vercel
**Opción A · con GitHub (recomendada, se actualiza sola en cada cambio):**
1. Subí esta carpeta a un repositorio de GitHub.
2. Entrá a https://vercel.com con tu cuenta de GitHub → **Add New → Project** → elegí el repositorio.
3. Framework Preset: **Other**. No hace falta build. Tocá **Deploy**.

**Opción B · desde la terminal:**
```bash
cd setto-web
npx vercel        # la primera vez te pide loguearte
npx vercel --prod
```

Te queda una dirección como `setto.vercel.app`. El panel está en `setto.vercel.app/panel`.
Si después comprás un dominio (por ejemplo `setto.com.ar`), se conecta en Vercel → Settings → Domains.

---

## Cómo se usa día a día

1. **El cliente pide en la web.** Elige productos, nombre, celular, horario y forma de pago. La web registra el pedido con un código (ej. `STT-4821`) y le abre WhatsApp con el mensaje armado.
2. **Llega el WhatsApp.** En el panel, pestaña **Pedidos**, aparece el pedido al instante con el mismo código.
3. **Revisás el número.** El campo "Número del chat de WhatsApp" viene con el número que puso el cliente. Si en el chat aparece otro número, lo corregís ahí.
4. **Al retirar, tocás "Entregado ✓".** Se suman los sellos al número del chat (1 por defecto, lo podés cambiar antes de tocar).
5. **El cliente consulta su tarjeta** en la web, en la sección Setto Club, con su celular.
6. **Canje:** en el panel, pestaña **Club**, buscás al cliente y tocás **Canjear premio** cuando completó la tarjeta.

Pedidos que no vienen de la web (WhatsApp directo, PedidosYa, Rappi, Uber Eats): pestaña **Club → Sumar sellos a mano**.

### Envío a domicilio
En el checkout el cliente elige **Retiro** o **Envío a domicilio**. Si elige envío, tiene que poner la dirección exacta (y opcionalmente piso/depto/referencia). En el panel el pedido aparece con la etiqueta **Envío a domicilio**, la dirección y un link a Google Maps.
En **Ajustes → Envío a domicilio** activás o desactivás la opción, ponés un costo fijo (0 = se coordina por WhatsApp) y el aviso que ve el cliente.
Con envío, la única forma de pago es **transferencia** (el envío lo hace Uber y no cobra los productos). La base rechaza un pedido con envío y otro medio de pago. En el mismo ajuste elegís cuál es esa forma de pago.

### Premio del Club
El premio se entrega **en el mismo pedido que completa la tarjeta**. Ejemplo con 8 sellos: el cliente con 7 sellos hace su pedido y en el checkout **elige su premio**:
- **Un set de regalo** (cualquier set activo, en 12 oz): se suma al pedido a $0.
- **25% off en ese pedido**: se descuenta del total de productos (sin envío), redondeado a $10.

Sin elegir, la web no deja enviar. El panel muestra 🎁 *Completa la tarjeta* con el premio elegido, y al tocar **Entregado** se canjea solo (la tarjeta vuelve a 0).
En **Ajustes → Setto Club** definís los sellos de la tarjeta, el texto del premio, si se ofrece el set, el % de descuento (0 = no se ofrece), un tope en $ para el descuento (0 = sin tope) y un pedido mínimo opcional para sumar sello.

### Personalización de bebidas
En los dirty y en los sets el cliente elige la leche (con recargo) y puede marcar "Sin cold foam", "Sin endulzante" o "Sin hielo". El recargo se suma al precio y se calcula en la base. En el WhatsApp y en el panel cada bebida muestra lo que eligió.
En **Ajustes → Personalización de bebidas** cambiás las leches (una por línea, `Nombre | recargo`, la primera es la de base) y las opciones para sacar.

### Pedir acá te conviene y logos de apps
En **Ajustes → Pedir acá te conviene** editás el título y los motivos (uno por línea, `título | detalle`) que se ven arriba de "Cómo pedir".
En **Ajustes → Apps de delivery** podés subir el logo oficial de cada app (cuadrado). Sin logo se ve la inicial.

### Seguimiento del pedido
Después de enviar, el cliente ve arriba de la web el estado de su pedido (se actualiza cada 30 segundos y al volver a la pestaña): **Recibido → En preparación → Listo para retirar / En camino → Entregado**. Si cancelás, le aparece cancelado.
En el panel, cada pedido pendiente tiene **Estado que ve el cliente**: Recibido / En preparación / Listo (o En camino). Al tocar **Entregado ✓** pasa a Entregado.

### Consultar pedido desde el carrito
Con el carrito vacío aparece **Consultar mi pedido** al lado de "Ver sets". Sirve si el cliente cerró la pestaña, cambió de navegador o de celular.
- **Celular + código:** ve el seguimiento completo y el pedido queda guardado en ese navegador.
- **Solo celular o solo código:** ve si tiene un pedido en curso y en qué etapa. Nada más: ni nombre, ni productos, ni total. Por celular el código aparece tapado (STT-••21).
- Busca pedidos sin entregar de los últimos 2 días. Función de la base: `buscar_pedido` (`023_consultar_pedido.sql`).

### Link de seguimiento
Cada pedido tiene un link propio (`/?seguir=…`). Va al final del WhatsApp que manda el cliente y en los avisos de estado del panel. Al abrirlo, en cualquier celular, ve el estado del pedido arriba de la web, sin escribir nada.
Después de enviar, la pantalla final muestra el estado en vivo y el botón **Reenviar mensaje por WhatsApp**.
Al tocar **Entregado ✓** en el panel aparece **Pedir reseña por WhatsApp**: abre el chat del cliente con el link para dejar su reseña (con foto) y ver sus sellos. También está en cada pedido de la pestaña Entregados.

### Reseñas
Cuando un pedido pasa a **Entregado**, el cliente ve en su seguimiento **Ver mis sellos** y **Dejar reseña** (estrellas + texto opcional). Solo puede dejar reseña quien recibió el pedido: una por pedido, dentro de los 14 días.
En el panel, pestaña **Reseñas**: **Publicar** u **Ocultar**. En la web, en "Lo que dicen", solo se ven las publicadas que tienen texto, con nombre e inicial (nunca el teléfono). El promedio aparece desde 3 reseñas.

- **Foto e Instagram (opcionales):** el cliente puede sumar una foto de su pedido y su usuario de Instagram. Cada reseña publicada muestra "✓ Compra verificada · pidió …" con lo que pidió de verdad. Revisá la foto antes de publicar.
- **Estrellas en la carta:** cada producto muestra su promedio y cantidad de reseñas publicadas de pedidos que lo incluían.

- **Todas las reseñas:** botón "Ver todas las reseñas" y link "Reseñas" en el menú: promedio, barras por estrellas, filtros (con foto, con comentario, por estrellas) e incluye las que son solo puntaje.

### Avisos en tu celu (panel)
Tocá la campanita 🔔 del panel y **Activar avisos**. Ese dispositivo recibe una notificación con cada pedido nuevo, gift card pedida, cliente que responde un cambio y reseña para aprobar, aunque el panel esté cerrado. Solo le llega a quien la active en su dispositivo; se apaga desde el mismo lugar.
En iPhone funciona solo con el panel agregado a la pantalla de inicio (Safari → Compartir → Agregar a inicio, iOS 16.4 o más) y activando desde ese ícono.
Usa la tabla `staff_push_subs` y la misma Edge Function `push-pedido` (migración `027_avisos_equipo.sql`). En producción, crear cada trigger por separado con `set lock_timeout`.

### Avisar por WhatsApp
Cada pedido pendiente tiene **Avisar por WhatsApp**: abre el chat del cliente con el mensaje del estado actual (recibido, en preparación, listo o en camino). Lo mandás vos con un toque, sin costo.

### Stock y pedidos
- **Pedido pendiente:** reserva sus mochis. La web muestra el disponible (Café − reservado) y la base frena lo que no alcanza.
- **Cancelar un pedido pendiente** en el panel libera la reserva al instante: vuelve a la web y a la pestaña Stock.
- **Entregado:** descuenta los mochis del Café y carga el ingreso en la caja.
- **Anular en la caja el ingreso de un pedido web** devuelve sus mochis al Café.
- En **Caja → Stock**, cada mochi muestra cuántos hay reservados en pedidos pendientes y cuántos ve la web.

### Portada y ¿Qué es un mochi?
En **Ajustes → Portada** cargás hasta 5 slides (foto, título corto, una línea) y cada cuántos segundos cambian. *Recorte* es para fotos de producto sin fondo (van sobre el círculo coral); *Foto* llena todo el espacio.
En **Ajustes → ¿Qué es un mochi?** editás título, texto, puntos (`título | detalle`) y la foto, o la ocultás.

### Decoración de temporada (Halloween)
En **Ajustes → Decoración de temporada** elegís *Halloween 🎃* y, si querés, un aviso arriba de la web (ej. "Edición Halloween · del 29/10 al 2/11"). Cambia colores de la cinta y de la Edición especial, y suma murciélagos, telaraña y calabaza en la portada. Se saca eligiendo *Ninguno*.
Los sabores de la edición se cargan en **Carta → Edición especial** (título de la sección, estado, etiqueta y sabores). Para que no se mezclen, desmarcá *Visible en la web* en los sabores de tortas hasta que salgan.

### Gift cards
En la web, sección **Regalá Setto**: el cliente elige diseño, monto, para quién, de quién y un mensaje, y la reserva por WhatsApp (pago por transferencia).
En el panel, pestaña **Gift cards** → **Por cobrar**: cuando te pagan, tocá **Pago recibido** (MP o efectivo). Se activa, entra como ingreso en la caja y aparece **Mandar link al comprador** con el link de regalo.
Quien la recibe abre el link, ve la tarjeta, el saldo y el código, y toca **Usarla en un pedido**. En el checkout se descuenta del total (envío incluido); si sobra, el saldo queda para otro pedido. Si cancelás ese pedido, el saldo vuelve.
Se puede anular mientras no se haya usado. En **Ajustes → Gift cards** elegís montos, mínimo, máximo y diseños.

### Votación
En **Ajustes → Votación**: pregunta, hasta 6 opciones con foto, "solo clientes" (votan números con un pedido entregado) y fecha de cierre opcional. Los resultados aparecen ahí mismo. "Empezar una votación nueva" arranca de cero.

### Abierto / cerrado
Arriba de la portada se ve "Abierto ahora · retirás desde las …" o "Cerrado · abrimos …", calculado con los horarios de retiro.

### Mensajes de WhatsApp
En **Ajustes → Mensajes de WhatsApp** editás todos los textos precargados: el inicio y cierre del pedido, el botón de consulta, la compra de gift card, los avisos de estado, el pedido de reseña y la gift card activada. Lo que va entre llaves (`{nombre}`, `{codigo}`, `{link}`…) se completa solo. "Volver al original" restaura el texto.

### Páginas aparte
- **/gift-cards**: la tienda de gift cards. Los links de regalo nuevos llevan a esta página.
- **/armar**: cómo armar la bebida (vaso, cold foam y hielo por separado), con descarga del PDF. Sirve para el QR del packaging.
- **Preguntas frecuentes**: al final del inicio. Se editan en **Ajustes → Preguntas frecuentes** (links con `[texto](/armar)`).
- **Imágenes de gift cards**: en **Ajustes → Gift cards** cada diseño puede llevar una imagen propia (horizontal, 1,6:1). Los vacíos sirven para sumar diseños nuevos.

### Edición especial (sabores de tortas)
En **Carta → Edición especial**:
- **Estado:** *Próximamente* (se muestra pero no se puede pedir) o *Disponible ahora* (se puede pedir).
- **Etiqueta de arriba:** por ejemplo "Edición de noviembre · del 14 al 16".
- En cada sabor: foto, precio (si está en 0, figura "a confirmar" y no se puede pedir), *Agotado* y *Visible en la web*.

### Fotos
"Subir foto" recorta la imagen cuadrada, la achica y la sube a Supabase Storage. Después tocá **Guardar** en esa tarjeta para que se vea en la web.

---

## Caja del equipo (`/caja`)

Reemplaza la app de Apps Script y la planilla "SETTO — Gastos, ingresos y resultados". Mismo login que el panel; cada celular elige una vez quién es (Isa, Alan o Lucas) y todo queda a su nombre.

**Instalar (una vez):** en Supabase → SQL Editor, correr `supabase/migrations/006_caja.sql` (tablas) y después `007_caja_historial.sql` (todo lo cargado en la planilla hasta el 14/10/2026). Se pueden correr de nuevo sin duplicar nada.

**Cómo funciona:** solo se guardan movimientos. Los saldos, lo que Setto le debe a cada socio, el resumen del mes y el stock los calcula la base a partir de los movimientos, así que no se pueden desincronizar. Los movimientos no se borran: se **anulan** con motivo, y cada edición queda en el historial.

| Tipo | Qué hace |
|---|---|
| Entrada | Suma a una cuenta (ventas, liquidaciones de PedidosYa/Rappi/Uber) |
| Gasto | Resta de una cuenta, o si lo pagó un socio de su bolsillo, Setto le queda debiendo |
| Aporte de socio | Un socio pone plata; Setto le queda debiendo |
| Devolución a socio | Setto le devuelve; baja la deuda |
| Retiro de ganancias | Un socio se lleva ganancias (no es deuda) |
| Transferencia | Pasa plata entre cuentas (ej. depositar efectivo en MP) |
| Ajuste por conteo | Se genera solo con el botón **Contar**: ponés lo que hay y se carga la diferencia |

**Pedidos web → caja y stock (`008_pedidos_a_caja_y_stock_web.sql`):** al tocar **Entregado** en el panel se carga sola la entrada en la caja (total de productos, sin envío: el envío lo paga el cliente aparte a Uber). "Efectivo al retirar" va a Efectivo; tarjeta y transferencia van a Mercado Pago. Se descuenta del stock del Café cada mochi, el mochi de cada set y el del set de regalo del Club. No hace falta cargar esos pedidos a mano. Los de PedidosYa, Rappi y Uber Eats se siguen cargando con la liquidación.

**Stock en la web:** los mochis, la edición especial (cuando está disponible) y los sets muestran cuántos quedan en el Café, con cartel "¡Últimos!" cuando quedan pocos y "Sin stock hoy" en 0. Se prende/apaga y se cambia el umbral en **Panel → Ajustes → Stock en la web**. Desde `009_stock_bloquea_pedidos.sql` también frena: no se puede pedir más de lo disponible (stock del Café menos lo pedido y pendiente). Lo controla la base, no solo la página. Se apaga en Ajustes → "No dejar pedir más de lo que hay".

**Retiros de socios:** en Inicio → Socios → **Ver retiros** (o `caja.html#retiros`). Muestra cuánto retiró cada socio por semana (lunes a domingo) o por mes, qué días retiró y el historial de períodos anteriores con el promedio. Se filtra por socio, se navega con ‹ › y se descarga en CSV. Lee los mismos movimientos de tipo *Retiro de ganancias* de `caja_movimientos`: no hay tabla aparte, así que lo cargado antes ya aparece. Cuenta por la fecha del retiro y no suma los anulados.

Además: **Stock** (Café / Produ, con traslados y conteos), **Tareas** y **Lista de compras** (al tildar algo, ofrece cargar el gasto y lo deja enlazado). En Movimientos se puede descargar cada mes en CSV.

---

## Seguridad (lo importante)
- Los **precios se calculan en la base**, no en el navegador. Si alguien modifica la página para cambiar un precio, el pedido se guarda igual con el precio real.
- Los clientes **no pueden ver pedidos ni datos de otros clientes**. Al consultar la tarjeta solo ven la cantidad de sellos de ese número.
- **Solo el equipo** (usuarios en la tabla `staff`) puede confirmar pedidos, sumar sellos, canjear y editar la carta.
- Límite anti-spam: máximo 6 pedidos por celular por hora.

## Límites del plan gratis
- **Supabase Free:** sobra para empezar (base de datos, fotos y usuarios). Si el proyecto pasa alrededor de una semana sin actividad, Supabase puede pausarlo; se reactiva desde su panel con un clic. Revisá los límites actuales en https://supabase.com/pricing.
- **Vercel Hobby:** gratis para sitios personales. Si Setto crece y factura por la web, revisá si corresponde el plan Pro: https://vercel.com/pricing.

## Lo que viene (no está en esta versión)
- **Verificación por código** (como Crumbl) para que el cliente vea su tarjeta solo después de confirmar su número por WhatsApp o SMS.
- Pago online con Mercado Pago.
- Pedidos para eventos/regalo y gift cards.

---

## Archivos
```
index.html          sitio público
panel.html          panel del equipo
css/site.css        estilos (sistema visual Setto)
css/panel.css       estilos del panel
js/config.js        ← acá van las claves de Supabase
js/api.js           conexión a Supabase / modo demo
js/site.js          lógica del sitio
js/panel.js         lógica del panel
caja.html / js/caja.js / css/caja.css   caja del equipo
js/seed.js          carta inicial para el modo demo
data/seed.json      carta inicial (fuente)
supabase/schema.sql tablas, seguridad, funciones y carta inicial
img/                fotos de producto, logo, Mochito y patrón
vercel.json         config de Vercel (url /panel, caché de imágenes)
```

### Probar en tu compu
```bash
cd setto-web
python3 -m http.server 8000
# abrí http://localhost:8000 y http://localhost:8000/panel.html
```

## Página /listo (QR del sticker)
- `/listo` es a donde lleva el QR de la bolsa: arriba "¡Llegó tu Setto!", después cómo armar la bebida, la reseña del pedido y los sellos.
- Reconoce el pedido solo si se pidió desde ese celular o se abrió el link del WhatsApp; si no, se busca con código (STT-1234) + celular.
- La reseña se puede dejar cuando el pedido está **listo** o **entregado** (migración 018).
- El mensaje "Pedir reseña" del panel ahora manda a `/listo?seguir=…`.
- Archivos del sticker: `img/qr/QR-setto-listo.pdf` (vector, 5,5 × 6,9 cm) y `.png`, apuntan a https://setto.com.ar/listo.

## Cambio de pedido cuando falta algo
- Panel → pedido pendiente → **¿Falta algo?**: marcás qué falta (y cuántos), nota opcional → **Pedir cambio al cliente** → botón para mandar el aviso por WhatsApp (texto editable en Ajustes → Mensajes, "Falta algo del pedido").
- El cliente abre su link de seguimiento y elige para cada faltante un reemplazo de la misma categoría con stock, o sacarlo, o cancelar el pedido. Ve el nuevo total antes de confirmar.
- La base recalcula el total, valida stock, devuelve saldo de gift card si baja y actualiza la reserva de stock. El panel muestra lo que eligió (en vivo).
- Migración 020 (`pedir_cambio`, `quitar_cambio`, `cambio_opciones`, `resolver_cambio`).
