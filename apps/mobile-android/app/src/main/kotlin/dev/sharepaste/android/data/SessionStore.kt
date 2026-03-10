package dev.sharepaste.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.preferencesDataStoreFile
import dev.sharepaste.android.data.model.PersistedSession
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

class SessionStore(context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    private val dataStore = PreferenceDataStoreFactory.create(
        produceFile = { context.preferencesDataStoreFile("sharepaste_session.preferences_pb") }
    )

    val sessionFlow: Flow<PersistedSession?> = dataStore.data
        .catch { error ->
            if (error is IOException) {
                emit(emptyPreferences())
            } else {
                throw error
            }
        }
        .map { prefs ->
            prefs[SESSION_JSON]?.takeIf { it.isNotBlank() }?.let { json.decodeFromString<PersistedSession>(it) }
        }

    suspend fun load(): PersistedSession? = sessionFlow.first()

    suspend fun save(session: PersistedSession) {
        dataStore.edit { prefs ->
            prefs[SESSION_JSON] = json.encodeToString(PersistedSession.serializer(), session)
        }
    }

    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(SESSION_JSON)
        }
    }

    private companion object {
        val SESSION_JSON = stringPreferencesKey("session_json")
    }
}
