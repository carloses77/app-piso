// Se carga dentro del service worker generado. El texto es fijo: el detalle se ve al abrir la app.
self.addEventListener('push', (evento) => {
  evento.waitUntil(self.registration.showNotification('PisoCompartido', {
    body: 'Tu compi ha cambiado una actividad de la casa. Ábrela para ver qué ha cambiado.',
    icon: '/icono.svg',
    tag: 'actividades',
    renotify: true,
  }))
})

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  evento.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
    const abierta = ventanas[0]
    return abierta ? abierta.focus() : self.clients.openWindow('/')
  }))
})
