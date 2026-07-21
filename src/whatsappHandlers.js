function isIgnoredChat(chatId) {
  return chatId === 'status@broadcast' || chatId.endsWith('@broadcast');
}

function resolveContactName(contact) {
  return contact.name || contact.pushname || contact.number;
}

function handleIncomingMessage({ chatId, isGroup, fromMe, contact, groupName }, db, nowIso) {
  if (isIgnoredChat(chatId) || fromMe) {
    return;
  }
  const name = isGroup && groupName ? groupName : resolveContactName(contact);
  db.upsertClientMessage(chatId, name, isGroup, nowIso);
}

function handleOutgoingMessage({ chatId, fromMe }, db, nowIso) {
  if (isIgnoredChat(chatId) || !fromMe) {
    return;
  }
  db.markReplied(chatId, nowIso);
}

module.exports = { isIgnoredChat, resolveContactName, handleIncomingMessage, handleOutgoingMessage };
