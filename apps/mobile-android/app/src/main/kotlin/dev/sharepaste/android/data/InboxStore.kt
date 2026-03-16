package dev.sharepaste.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.preferencesDataStoreFile
import dev.sharepaste.android.data.model.InboxItem
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

class InboxStore(context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    private val dataStore = PreferenceDataStoreFactory.create(
        produceFile = { context.preferencesDataStoreFile("sharepaste_inbox.preferences_pb") }
    )

    val inboxFlow: Flow<List<InboxItem>> = dataStore.data
        .catch { error ->
            if (error is IOException) {
                emit(emptyPreferences())
            } else {
                throw error
            }
        }
        .map { prefs ->
            prefs[INBOX_JSON]?.takeIf { it.isNotBlank() }?.let(::decodeInbox).orEmpty()
        }

    suspend fun load(): List<InboxItem> = inboxFlow.first()

    suspend fun save(items: List<InboxItem>) {
        dataStore.edit { prefs ->
            prefs[INBOX_JSON] = json.encodeToString(ListSerializer(InboxItem.serializer()), items)
        }
    }

    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(INBOX_JSON)
        }
    }

    private fun decodeInbox(raw: String): List<InboxItem> =
        runCatching {
            json.decodeFromString(ListSerializer(InboxItem.serializer()), raw)
        }.getOrDefault(emptyList())

    private companion object {
        val INBOX_JSON = stringPreferencesKey("inbox_json")
    }
}
