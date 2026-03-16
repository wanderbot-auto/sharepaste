package dev.sharepaste.android

import android.app.Application
import dev.sharepaste.android.data.InboxStore
import dev.sharepaste.android.data.IncomingItemStore
import dev.sharepaste.android.data.SessionStore
import dev.sharepaste.android.data.SharePasteCrypto
import dev.sharepaste.android.data.SharePasteRepository
import dev.sharepaste.android.data.SharePasteTransport

class SharePasteApplication : Application() {
    lateinit var repository: SharePasteRepository
        private set

    override fun onCreate() {
        super.onCreate()
        repository = SharePasteRepository(
            appContext = applicationContext,
            sessionStore = SessionStore(applicationContext),
            inboxStore = InboxStore(applicationContext),
            transport = SharePasteTransport(),
            crypto = SharePasteCrypto(),
            incomingItemStore = IncomingItemStore(applicationContext)
        )
    }
}
