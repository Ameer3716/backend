// utils/gohighlevel.js
const axios = require('axios');
require('dotenv').config(); // Load env vars from .env in the project root

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_VERSION = process.env.GHL_API_VERSION || '2021-07-28'; // Use version from .env or default

if (!GHL_API_KEY) {
    console.warn("🔴 GHL WARNING: GHL_API_KEY is not configured in .env file. GoHighLevel integration will be disabled.");
}

// Base instance for GHL API calls
const ghlApi = axios.create({
  baseURL: 'https://rest.gohighlevel.com/v1',
  headers: {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version':       GHL_API_VERSION,
    'Content-Type':  'application/json',
    'Accept':        'application/json'
  },
  timeout: 15000 // Increased timeout
});

// --- Helper Functions based on testGHL.js and Docs ---

/**
 * Looks up a contact by email or phone.
 * GET /v1/contacts/lookup
 * @param {object} params - { email: string } or { phone: string }
 * @returns {Promise<object|null>} - The first matching contact object or null.
 */
async function lookupContact(params) {
    if (!GHL_API_KEY) return null;
    if (!params || (!params.email && !params.phone)) {
        console.error("🔴 GHL Lookup Error: Email or Phone is required.");
        return null;
    }
    const identifier = params.email || params.phone;
    try {
        console.log(`🔍 GHL: GET /contacts/lookup for ${identifier}`);
        const response = await ghlApi.get('/contacts/lookup', { params });
        if (response.data?.contacts?.length > 0) {
            console.log(`✅ GHL Lookup: Found contact ID ${response.data.contacts[0].id} for ${identifier}`);
            return response.data.contacts[0]; // Return the first match
        } else {
            console.log(`ℹ️ GHL Lookup: No contact found for ${identifier}`);
            return null;
        }
    } catch (error) {
        // Specifically handle 404 as "not found", otherwise log error
        if (error.response && error.response.status === 404) {
            console.log(`ℹ️ GHL Lookup: No contact found for ${identifier} (404)`);
            return null;
        } else {
            const errorMsg = error.response?.data?.message || error.response?.data || error.message;
            console.error(`🔴 GHL Lookup Error for ${identifier}:`, errorMsg);
            return null;
        }
    }
}

/**
 * Creates a new contact.
 * POST /v1/contacts/
 * @param {object} contactData - Includes email, firstName, lastName, phone, tags, source, customField object { fieldId: value }
 * @returns {Promise<object|null>} - The created contact object or null.
 */
async function createContact(contactData) {
    if (!GHL_API_KEY) return null;
    if (!contactData || (!contactData.email && !contactData.phone)) {
        console.error("🔴 GHL Create Error: Email or Phone is required.");
        return null;
    }

    // Prepare payload, ensuring customField is handled correctly if present
    const payload = { ...contactData };
    if (payload.customFields && !payload.customField) { // Handle if caller passed array format accidentally
         payload.customField = payload.customFields.reduce((obj, { id, value }) => {
             obj[id] = value;
             return obj;
        }, {});
        delete payload.customFields; // Remove the array format
    }
     // Ensure name field exists if firstName or lastName are present
    if (!payload.name && (payload.firstName || payload.lastName)) {
        payload.name = `${payload.firstName || ''} ${payload.lastName || ''}`.trim();
    }
    // Remove undefined fields
    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    try {
        console.log(`➕ GHL: POST /contacts/`, payload);
        const response = await ghlApi.post('/contacts/', payload);
        const contact = response.data?.contact || response.data; // Handle potential response variations

        if (contact && contact.id) {
            console.log(`✅ GHL Create: Contact created successfully. ID: ${contact.id}`);
            return contact;
        } else {
            console.warn(`⚠️ GHL Create Warning: Response did not contain expected contact data. Response:`, response.data);
            return null;
        }
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data || error.message;
        console.error(`🔴 GHL Create Error for ${payload.email || payload.phone}:`, errorMsg);
        return null;
    }
}

/**
 * Gets a specific contact by its ID.
 * GET /v1/contacts/:contactId
 * @param {string} contactId - The GHL Contact ID.
 * @returns {Promise<object|null>} - The contact object or null.
 */
async function getContact(contactId) {
  if (!GHL_API_KEY) return null;
  if (!contactId) {
       console.error("🔴 GHL Get Error: Contact ID is required.");
       return null;
  }
  try {
    console.log(`🔍 GHL: GET /contacts/${contactId}`);
    const resp = await ghlApi.get(`/contacts/${contactId}`);
    console.log(`✅ GHL Get: Success for contact ${contactId}. Status: ${resp.status}`);
    return resp.data?.contact; // Response structure usually nests under 'contact'
  } catch (err) {
     // Handle 404 as contact not found
     if (err.response && err.response.status === 404) {
         console.log(`ℹ️ GHL Get: Contact ${contactId} not found (404).`);
         return null;
     } else {
         const errorMsg = err.response?.data?.message || err.response?.data || err.message;
         console.error(`🔴 GHL Get Error for ${contactId}:`, errorMsg);
         return null;
     }
  }
}

/**
 * Updates an existing contact by its ID.
 * PUT /v1/contacts/:contactId
 * @param {string} contactId - The GHL Contact ID.
 * @param {object} updates - Object containing fields to update (e.g., tags, customField object { fieldId: value }).
 * @returns {Promise<object|null>} - The updated contact object or null.
 */
async function updateContact(contactId, updates) {
  if (!GHL_API_KEY) return null;
  if (!contactId || !updates || Object.keys(updates).length === 0) {
    console.error("🔴 GHL Update Error: Contact ID and updates object are required.");
    return null;
  }

   // Prepare payload, ensuring customField is handled correctly if present
    const payload = { ...updates };
    if (payload.customFields && !payload.customField) { // Handle if caller passed array format accidentally
         payload.customField = payload.customFields.reduce((obj, { id, value }) => {
             obj[id] = value;
             return obj;
        }, {});
        delete payload.customFields; // Remove the array format
    }
    // Remove undefined fields
    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);


  try {
    console.log(`🔄 GHL: PUT /contacts/${contactId}`, payload);
    const resp = await ghlApi.put(`/contacts/${contactId}`, payload);
    const contact = resp.data?.contact || resp.data; // Handle potential response variations

    if (contact) { // Update might just return the updated contact or limited info
        console.log(`✅ GHL Update: Contact ${contactId} updated successfully. Status: ${resp.status}`);
        // Return full contact if possible, otherwise indicate success with ID
        return contact.id ? contact : { ...contact, id: contactId };
    } else {
         console.warn(`⚠️ GHL Update Warning: Response did not contain expected data for ${contactId}. Response:`, resp.data);
         return null;
    }
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error(`🔴 GHL Update Error for ${contactId}:`, errorMsg);
    return null;
  }
}

/**
 * Creates or updates a contact using Lookup then Create/Update.
 * @param {object} contactData - Includes email, phone, firstName, lastName, tags, source, customField object { fieldId: value }
 * @returns {Promise<object|null>} - The created/updated contact object or null.
 */
async function createOrUpdateContact(contactData) {
    if (!GHL_API_KEY) return null;
    if (!contactData || (!contactData.email && !contactData.phone)) {
        console.error("🔴 GHL Create/Update Error: Email or Phone is required.");
        return null;
    }
    // Determine identifier used for lookup
    const identifier = contactData.email ? { email: contactData.email } : { phone: contactData.phone };
    const identifierValue = contactData.email || contactData.phone;

    try {
        const existingContact = await lookupContact(identifier);

        if (existingContact && existingContact.id) {
            // --- UPDATE LOGIC ---
            console.log(`ℹ️ GHL: Found existing contact ${existingContact.id} for ${identifierValue}. Preparing update payload.`);

            // Prepare update payload, EXCLUDING the identifier keys (email/phone)
            const updatePayload = { ...contactData };
            if (contactData.email) delete updatePayload.email;
            if (contactData.phone) delete updatePayload.phone;

            // Check if there's anything actually left in the payload to update
            if (Object.keys(updatePayload).length > 0) {
                console.log(`ℹ️ GHL: Attempting update for contact ${existingContact.id}.`);
                // Pass the filtered payload containing only the fields to be updated
                return await updateContact(existingContact.id, updatePayload);
            } else {
                 // This happens if contactData ONLY contained email/phone used for lookup
                 console.log(`ℹ️ GHL: No new data provided to update contact ${existingContact.id}. Returning existing contact info.`);
                 return existingContact; // Return the contact data found during lookup
            }
        } else {
            // --- CREATE LOGIC ---
            console.log(`ℹ️ GHL: No existing contact found for ${identifierValue}, attempting creation.`);
            // Pass the original full contactData for creation
            return await createContact(contactData);
        }
    } catch (error) {
         // Errors from lookup/create/update should be logged within those functions
         console.error(`🔴 GHL createOrUpdateContact process failed for ${identifierValue}.`);
         return null;
    }
}
/**
 * Safely adds tags to a GoHighLevel contact by Contact ID, merging with existing tags.
 * Uses getContact and updateContact internally.
 * @param {string} contactId - The GHL Contact ID.
 * @param {string[]} tagsToAdd - An array of tags to add.
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function addTagsToContact(contactId, tagsToAdd) {
    if (!GHL_API_KEY) return false;
    if (!contactId || !Array.isArray(tagsToAdd) || tagsToAdd.length === 0) {
        console.error("🔴 GHL AddTags Error: Contact ID and a non-empty tags array are required.");
        return false;
    }

    try {
        console.log(`ℹ️ GHL AddTags: Fetching contact ${contactId} to merge tags.`);
        const currentContact = await getContact(contactId);

        if (!currentContact) {
            console.error(`🔴 GHL AddTags Error: Contact ${contactId} not found.`);
            return false; // Can't add tags if contact doesn't exist
        }

        const existingTags = currentContact.tags || [];
        const updatedTags = [...new Set([...existingTags, ...tagsToAdd])];

        // Only update if tags actually changed
        if (JSON.stringify(existingTags.sort()) !== JSON.stringify(updatedTags.sort())) {
             console.log(`ℹ️ GHL AddTags: Updating contact ${contactId} with tags: [${updatedTags.join(', ')}]`);
             const updateResult = await updateContact(contactId, { tags: updatedTags });
             if (updateResult) {
                 console.log(`✅ GHL AddTags: Tags updated successfully for contact ID: ${contactId}`);
                 return true;
             } else {
                  console.error(`🔴 GHL AddTags Error: Failed to update contact ${contactId} with new tags.`);
                  return false;
             }
        } else {
             console.log(`ℹ️ GHL AddTags: No new tags to add for contact ${contactId}. Skipping update.`);
             return true; // Considered successful as no change needed
        }

    } catch (error) {
         // Errors from getContact/updateContact are logged within those functions
         console.error(`🔴 GHL AddTags Exception for ${contactId}:`, error);
         return false;
    }
}

/**
 * Creates a note for a specific contact.
 * POST /v1/contacts/:contactId/notes
 * @param {string} contactId - The GHL Contact ID.
 * @param {string} noteBody - The content of the note.
 * @param {string} [userId] - Optional GHL User ID to associate the note with.
 * @returns {Promise<object|null>} - The created note object or null.
 */
async function createNoteForContact(contactId, noteBody, userId = null) {
    if (!GHL_API_KEY) return null;
    if (!contactId || !noteBody) {
        console.error("🔴 GHL CreateNote Error: Contact ID and note body are required.");
        return null;
    }

    const payload = { body: noteBody };
    if (userId) { payload.userId = userId; } // Add GHL User ID if provided

    try {
        console.log(`📝 GHL: POST /contacts/${contactId}/notes`, payload);
        const response = await ghlApi.post(`/contacts/${contactId}/notes`, payload);

        if (response.data && response.data.id) {
            console.log(`✅ GHL CreateNote: Note created successfully for contact ${contactId}. Note ID: ${response.data.id}`);
            return response.data;
        } else {
             console.warn(`⚠️ GHL CreateNote Warning: Response did not contain expected data for contact ${contactId}. Response:`, response.data);
             return null;
        }
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data || error.message;
        console.error(`🔴 GHL CreateNote Error for contact ${contactId}:`, errorMsg);
        return null;
    }
}

/**
 * Deletes a specific note for a contact.
 * DELETE /v1/contacts/:contactId/notes/:noteId
 * @param {string} contactId - The GHL Contact ID.
 * @param {string} noteId - The ID of the note to delete.
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function deleteNote(contactId, noteId) {
  if (!GHL_API_KEY) return false;
  if (!contactId || !noteId) {
       console.error("🔴 GHL DeleteNote Error: Contact ID and Note ID are required.");
       return false;
  }
  try {
    console.log(`🗑️ GHL: DELETE /contacts/${contactId}/notes/${noteId}`);
    const resp = await ghlApi.delete(`/contacts/${contactId}/notes/${noteId}`);
    // DELETE often returns 200 or 204, check for success range
    if (resp.status >= 200 && resp.status < 300) {
        console.log(`✅ GHL DeleteNote: Successfully deleted note ${noteId} for contact ${contactId}. Status: ${resp.status}`);
        return true;
    } else {
         console.warn(`⚠️ GHL DeleteNote Warning: Unexpected status ${resp.status} for note ${noteId}.`);
         return false; // Or based on specific GHL behavior for delete
    }
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error(`🔴 GHL DeleteNote Error for note ${noteId}:`, errorMsg);
    return false;
  }
}

/**
 * Deletes a contact by its ID.
 * DELETE /v1/contacts/:contactId
 * @param {string} contactId - The GHL Contact ID.
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function deleteContact(contactId) {
  if (!GHL_API_KEY) return false;
   if (!contactId) {
       console.error("🔴 GHL DeleteContact Error: Contact ID is required.");
       return false;
  }
  try {
    console.log(`🗑️ GHL: DELETE /contacts/${contactId}`);
    const resp = await ghlApi.delete(`/contacts/${contactId}`);
    // DELETE often returns 200 or 204
     if (resp.status >= 200 && resp.status < 300) {
        console.log(`✅ GHL DeleteContact: Successfully deleted contact ${contactId}. Status: ${resp.status}`);
        return true;
     } else {
         console.warn(`⚠️ GHL DeleteContact Warning: Unexpected status ${resp.status} for contact ${contactId}.`);
         return false;
     }
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error(`🔴 GHL DeleteContact Error for ${contactId}:`, errorMsg);
    return false;
  }
}


module.exports = {
  createContact,
  getContact,
  updateContact,
  lookupContact,
  createOrUpdateContact, // Uses the above internally
  addTagsToContact,      // Uses get/update internally
  createNoteForContact,
  deleteNote,
  deleteContact,
};