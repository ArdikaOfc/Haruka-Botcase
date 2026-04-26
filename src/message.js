import '../settings.js';
import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import chalk from 'chalk';
import crypto from 'crypto';
import FileType from 'file-type';
import chokidar from 'chokidar';
import { fileURLToPath } from 'url';
import PhoneNumber from 'awesome-phonenumber';

import { checkStatus } from './database.js';
import { imageToWebp, videoToWebp, writeExif, gifToWebp } from '../lib/exif.js';
import { getBuffer, getSizeMedia, fetchJson, sleep, axiosss, fixBytes } from '../lib/function.js';
import { jidNormalizedUser, proto, getBinaryNodeChildren, getBinaryNodeChildString, getBinaryNodeChild, generateMessageIDV2, jidEncode, encodeSignedDeviceIdentity, generateWAMessageContent, generateForwardMessageContent, prepareWAMessageMedia, delay, areJidsSameUser, extractMessageContent, generateMessageID, downloadContentFromMessage, generateWAMessageFromContent, jidDecode, generateWAMessage, toBuffer, getContentType, getDevice } from 'baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const harukaPath = fileURLToPath(new URL('../haruka.js', import.meta.url));

let harukaHandler = null;
const botStartTime = Date.now();
const groupMetadataTimers = {};

/*
	* Create By Naze
	* Follow https://github.com/nazedev
	* Whatsapp : https://whatsapp.com/channel/0029VaWOkNm7DAWtkvkJBK43
*/

const reloadHandler = async () => {
	try {
		harukaHandler = (await import(`../haruka.js?update=${Date.now()}`)).default;
	} catch (err) {
		console.error(chalk.redBright(`[ERROR] ${err}`));
	}
};

reloadHandler();

async function GroupUpdate(haruka, m, store) {
	function clearParse(parse) {
		try {
			return JSON.parse(parse);
		} catch {
			return parse;
		}
	}
	if (!m.messageStubType || !m.isGroup) return
	if (global.db?.groups?.[m.chat] && store?.groupMetadata?.[m.chat]) {
		const admin = `@${m.sender.split('@')[0]}`
		const metadata = store.groupMetadata[m.chat];
		const normalizedTarget = clearParse(m.messageStubParameters[0]);
		const type = m.messageStubType;
		const messages = {
			1: 'mereset link grup!',
			21: `mengubah Subject Grup menjadi :\n*${normalizedTarget}*`,
			22: 'telah mengubah icon grup.',
			23: 'mereset link grup!',
			24: `mengubah deskripsi grup.\n\n${normalizedTarget}`,
			25: `telah mengatur agar *${normalizedTarget == 'on' ? 'hanya admin' : 'semua peserta'}* yang dapat mengedit info grup.`,
			26: `telah *${normalizedTarget == 'on' ? 'menutup' : 'membuka'}* grup!\nSekarang ${normalizedTarget == 'on' ? 'hanya admin yang' : 'semua peserta'} dapat mengirim pesan.`,
			29: `telah menjadikan @${normalizedTarget?.id?.split('@')?.[0]} sebagai admin.`,
			30: `telah memberhentikan @${normalizedTarget?.id?.split('@')?.[0]} dari admin.`,
			72: `mengubah durasi pesan sementara menjadi *@${normalizedTarget}*`,
			123: 'menonaktifkan pesan sementara.',
			132: 'mereset link grup!',
			172: `@${normalizedTarget?.pn?.split('@')?.[0]} meminta bergabung`,
		}
		if (haruka.public && global.db?.groups?.[m.chat]?.setinfo && messages[type]) {
			await haruka.sendMessage(m.chat, { text: `${admin} ${messages[type]}`, mentions: [m.sender, ...((normalizedTarget?.id || normalizedTarget)?.includes('@') ? [`${normalizedTarget.id || normalizedTarget}`] : [])].filter(Boolean)}, { ephemeralExpiration: m.expiration || m?.metadata?.ephemeralDuration || store?.messages[m.chat]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 })
		}
		if (type === 20) {
			clearTimeout(groupMetadataTimers[m.chat])
			groupMetadataTimers[m.chat] = setTimeout(async () => {
				store.groupMetadata[m.chat] = await haruka.groupMetadata(m.chat).catch(e => ({ ...store.groupMetadata[m.chat] }));
			}, 5000);
		} else if (type === 29 || type === 30) {
			const target = jidNormalizedUser(normalizedTarget.id || normalizedTarget)
			const newAdminValue = type === 29 ? 'admin' : null
			if (metadata?.participants?.length) {
				metadata.participants = metadata.participants.map(p => {
					const key = metadata.addressingMode === 'lid' ? jidNormalizedUser(p.id) : jidNormalizedUser(p.phoneNumber)
					if (key === target) {
						return { ...p, admin: newAdminValue }
					}
					return p
				})
			}
		} else if (type === 27) {
			if (!metadata.participants.some(a => (a.id === (normalizedTarget.id || normalizedTarget) || a.phoneNumber === (normalizedTarget.id || normalizedTarget)))) {
				clearTimeout(groupMetadataTimers[m.chat])
				groupMetadataTimers[m.chat] = setTimeout(async () => {
					store.groupMetadata[m.chat] = await haruka.groupMetadata(m.chat).catch(e => ({ ...store.groupMetadata[m.chat] }));
				}, 5000);
			}
		} else if (type === 28 || type === 32) {
			if (m.fromMe && ((jidNormalizedUser(haruka.user.id) == (normalizedTarget.id || normalizedTarget)) || (jidNormalizedUser(haruka.user.lid) == (normalizedTarget.id || normalizedTarget)))) {
				delete store.messages[m.chat];
				delete store.presences[m.chat];
				delete store.groupMetadata[m.chat];
			}
			if(!!metadata) metadata.participants = metadata.participants.filter(p => {
				const key = metadata.addressingMode === 'lid' ? jidNormalizedUser(p.id) : jidNormalizedUser(p.phoneNumber)
				return key !== (normalizedTarget.id || normalizedTarget)
			});
		} else {
			console.log({
				messageStubType: m.messageStubType, type,
				messageStubParameters: m.messageStubParameters,
			})
		}
	}
}

async function GroupParticipantsUpdate(haruka, update, store) {
	try {
		const { id, participants, author, action } = update;
		function updateAdminStatus(participants, metadataParticipants, status) {
			for (const participant of metadataParticipants) {
				if (participants.includes(jidNormalizedUser(participant.id)) || participants.includes(jidNormalizedUser(participant.phoneNumber))) {
					participant.admin = status;
				}
			}
		}
		if (global.db?.groups?.[id] && store?.groupMetadata?.[id]) {
			const metadata = store.groupMetadata[id];
			for (let n of participants) {
				const jid = typeof n === 'string' ? n : (n?.phoneNumber || n?.id || '');
				const participant = metadata.participants.find(a => a.id == jidNormalizedUser(jid))
				let profile;
				try {
					profile = await haruka.profilePictureUrl(jid, 'image');
				} catch {
					profile = 'https://telegra.ph/file/95670d63378f7f4210f03.png';
				}
				let messageText;
				if (action === 'add') {
					if (global.db.groups[id]?.welcome) messageText = global.db.groups[id]?.text?.setwelcome || `Welcome to ${metadata.subject}\n@`;
					if (!participant) {
						clearTimeout(groupMetadataTimers[id])
						groupMetadataTimers[id] = setTimeout(async () => {
							store.groupMetadata[id] = await haruka.groupMetadata(id).catch(e => ({ ...store.groupMetadata[id] }));
						}, 5000);
					}
				} else if (action === 'remove') {
					if (global.db.groups[id]?.leave) messageText = global.db.groups[id]?.text?.setleave || `@\nLeaving From ${metadata.subject}`;
					if ((jidNormalizedUser(haruka.user.lid) == jidNormalizedUser(jid)) || (jidNormalizedUser(haruka.user.id) == jidNormalizedUser(jid))) {
						delete store.messages[id];
						delete store.presences[id];
						delete store.groupMetadata[id];
					}
					if(metadata) metadata.participants = metadata.participants.filter(p => !participants.includes(metadata.addressingMode === 'lid' ? jidNormalizedUser(p.id) : jidNormalizedUser(p.phoneNumber)));
				} else if (action === 'promote') {
					if (global.db.groups[id]?.promote) messageText = global.db.groups[id]?.text?.setpromote || `@\nPromote From ${metadata.subject}\nBy @admin`;
					updateAdminStatus(participants, metadata.participants, 'admin');
				} else if (action === 'demote') {
					if (global.db.groups[id]?.demote) messageText = global.db.groups[id]?.text?.setdemote || `@\nDemote From ${metadata.subject}\nBy @admin`;
					updateAdminStatus(participants, metadata.participants, null);
				}
				if (messageText && haruka.public) {
					await haruka.sendMessage(id, {
						text: messageText.replace('@subject', metadata.subject).replace('@admin', author ? `@${author.split('@')[0]}` : '@admin').replace(/(?<=\s|^)@(?!\w)/g, `@${jid.split('@')[0]}`),
						contextInfo: {
							mentionedJid: [jid, author].filter(Boolean),
							externalAdReply: {
								title: action == 'add' ? 'Welcome' : action == 'remove' ? 'Leaving' : action.charAt(0).toUpperCase() + action.slice(1),
								mediaType: 1,
								previewType: 0,
								thumbnailUrl: profile,
								renderLargerThumbnail: true,
								sourceUrl: global.my.gh
							}
						}
					}, { ephemeralExpiration: metadata?.ephemeralDuration || store?.messages[id]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 });
				}
			}
		}
	} catch (e) {
		throw e;
	}
}

async function LoadDataBase(haruka, m) {
	try {
		const botNumber = await haruka.decodeJid(haruka.user.id);
		let game = global.db.game || {};
		let premium = global.db.premium || [];
		let user = global.db.users[m.sender] || {};
		let setBot = global.db.set[botNumber] || {};
		
		global.db.game = game;
		global.db.users[m.sender] = user;
		global.db.set[botNumber] = setBot;
		
		const defaultSetBot = {
			lang: 'id',
			limit: 0,
			money: 0,
			status: 0,
			log: true,
			join: false,
			public: true,
			anticall: true,
			original: true,
			readsw: false,
			autobio: false,
			autoread: true,
			antispam: false,
			autotyping: true,
			grouponly: true,
			multiprefix: false,
			privateonly: true,
			didyoumean: true,
			author: global.author || 'Harukadev',
			authorPrefix: '',
			autobackup: false,
			botname: global.botname || 'Hitori Bot',
			packname: global.packname || 'Bot WhatsApp',
			template: 'documentMessage',
			owner: global.owner,
		};
		for (let key in defaultSetBot) {
			if (!(key in setBot)) setBot[key] = defaultSetBot[key];
		}
		
		const limitUser = user.vip ? global.limit.vip : checkStatus(m.sender, premium) ? global.limit.premium : global.limit.free;
		const moneyUser = user.vip ? global.money.vip : checkStatus(m.sender, premium) ? global.money.premium : global.money.free;
		
		const defaultUser = {
			vip: false,
			ban: false,
			afkTime: -1,
			afkReason: '',
			register: false,
			limit: limitUser,
			money: moneyUser,
			lastclaim: Date.now(),
			lastbegal: Date.now(),
			lastrampok: Date.now(),
		};
		for (let key in defaultUser) {
			if (!(key in user)) user[key] = defaultUser[key];
		}
		
		if (m.isGroup) {
			let group = global.db.groups[m.chat] || {};
			global.db.groups[m.chat] = group;
			
			const defaultGroup = {
				url: '',
				text: {},
				warn: {},
				tagsw: {},
				nsfw: false,
				mute: false,
				leave: false,
				setinfo: false,
				antilink: false,
				demote: false,
				antitoxic: false,
				promote: false,
				welcome: false,
				antivirtex: false,
				antitagsw: false,
				antidelete: false,
				antihidetag: false,
				waktusholat: false,
			};
			for (let key in defaultGroup) {
				if (!(key in group)) group[key] = defaultGroup[key];
			}
		}
		
		const defaultGame = {
			suit: {},
			chess: {},
			chat_ai: {},
			menfes: {},
			tekateki: {},
			tictactoe: {},
			tebaklirik: {},
			kuismath: {},
			blackjack: {},
			tebaklagu: {},
			tebakkata: {},
			family100: {},
			susunkata: {},
			tebakbom: {},
			ulartangga: {},
			tebakkimia: {},
			caklontong: {},
			tebakangka: {},
			tebaknegara: {},
			tebakgambar: {},
			tebakbendera: {},
		};
		for (let key in defaultGame) {
			if (!(key in game)) game[key] = defaultGame[key];
		}
		
	} catch (e) {
		throw e
	}
}

async function MessagesUpsert(haruka, message, store) {
	try {
		let botNumber = await haruka.decodeJid(haruka.user.id);
		const msg = message.messages[0];
		if ((msg?.messageTimestamp * 1000) < botStartTime) return;
		const remoteJid = msg.key.remoteJid;
		(store.messages ??= {})[remoteJid] ??= {};
		store.messages[remoteJid].array ??= [];
		store.messages[remoteJid].keyId ??= new Set();
		if (!(store.messages[remoteJid].keyId instanceof Set)) {
			store.messages[remoteJid].keyId = new Set(store.messages[remoteJid].array.map(m => m.key.id));
		}
		if (store.messages[remoteJid].keyId.has(msg.key.id)) return;
		store.messages[remoteJid].array.push(msg);
		store.messages[remoteJid].keyId.add(msg.key.id);
		if (!store.groupMetadata || Object.keys(store.groupMetadata).length === 0) store.groupMetadata ??= await haruka.groupFetchAllParticipating().catch(e => ({}));
		const type = msg.message ? (getContentType(msg.message) || Object.keys(msg.message)[0]) : '';
		const m = await Serialize(haruka, msg, store);
		if (harukaHandler) {
			harukaHandler(haruka, m, msg, store);
		} else {
			await reloadHaruka();
			if (harukaHandler) harukaHandler(haruka, m, msg, store);
		}
		if (global.db?.set?.[botNumber]?.readsw && msg.key.remoteJid === 'status@broadcast') {
			await haruka.readMessages([msg.key]);
			if (/protocolMessage/i.test(type)) await haruka.sendFromOwner(global.db?.set?.[botNumber]?.owner || global.owner, 'Status dari @' + msg.key.participant.split('@')[0] + ' Telah dihapus', msg, { mentions: [msg.key.participant] });
			if (/(audioMessage|imageMessage|videoMessage|extendedTextMessage)/i.test(type)) {
				let keke = (type == 'extendedTextMessage') ? `Story Teks Berisi : ${msg.message.extendedTextMessage.text ? msg.message.extendedTextMessage.text : ''}` : (type == 'imageMessage') ? `Story Gambar ${msg.message.imageMessage.caption ? 'dengan Caption : ' + msg.message.imageMessage.caption : ''}` : (type == 'videoMessage') ? `Story Video ${msg.message.videoMessage.caption ? 'dengan Caption : ' + msg.message.videoMessage.caption : ''}` : (type == 'audioMessage') ? 'Story Audio' : '\nTidak diketahui cek saja langsung'
				await haruka.sendFromOwner(global.db?.set?.[botNumber]?.owner || global.owner, `Melihat story dari @${msg.key.participant.split('@')[0]}\n${keke}`, msg, { mentions: [msg.key.participant] });
			}
		}
	} catch (e) {
		console.log(message);
		throw e;
	}
}

async function Solving(haruka, store) {
	haruka.serializeM = (m) => MessagesUpsert(haruka, m, store)
	
	haruka.decodeJid = (jid) => {
		if (!jid) return jid
		if (/:\d+@/gi.test(jid)) {
			let decode = jidDecode(jid) || {}
			return decode.user && decode.server && decode.user + '@' + decode.server || jid
		} else return jid
	}
	
	haruka.findJidByLid = (lid, store, resolve = false) => {
		const groupMeta = store?.groupMetadata
		if (groupMeta) {
			for (const g of Object.values(groupMeta)) {
				if (!g?.participants) continue
				for (const contact of g.participants) {
					if (((contact?.id?.includes(lid)) || (contact?.phoneNumber?.includes(lid))) && contact?.phoneNumber) {
						return contact.phoneNumber
					}
				}
			}
		}
		const contacts = store?.contacts
		if (contacts) {
			for (const contact of Object.values(contacts)) {
				if (((contact?.id?.includes(lid)) || (contact?.phoneNumber?.includes(lid))) && contact?.phoneNumber) {
					return contact.phoneNumber
				}
			}
		}
		if (resolve) return lid
		return null
	}
	
	haruka.getName = (jid, withoutContact  = false) => {
		const id = haruka.decodeJid(jid);
		if (id.endsWith('@g.us')) {
			const groupInfo = store.contacts[id] || (store.groupMetadata[id] ? store.groupMetadata[id] : (store.groupMetadata[id] = haruka.groupMetadata(id))) || {};
			return Promise.resolve(groupInfo.name || groupInfo.subject || PhoneNumber('+' + id.replace('@g.us', '')).getNumber('international'));
		} else {
			if (id === '0@s.whatsapp.net') {
				return 'WhatsApp';
			}
		const contactInfo = store.contacts[id] || {};
		return withoutContact ? '' : contactInfo.name || contactInfo.subject || contactInfo.verifiedName || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international');
		}
	}
	
	haruka.sendContact = async (jid, kon, quoted = '', opts = {}) => {
		let list = []
		for (let i of kon) {
			list.push({
				displayName: await haruka.getName(i + '@s.whatsapp.net'),
				vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await haruka.getName(i + '@s.whatsapp.net')}\nFN:${await haruka.getName(i + '@s.whatsapp.net')}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nitem2.ADR:;;Indonesia;;;;\nitem2.X-ABLabel:Region\nEND:VCARD`
			})
		}
		haruka.sendMessage(jid, { contacts: { displayName: `${list.length} Kontak`, contacts: list }, ...opts }, { quoted, ephemeralExpiration: quoted?.expiration || quoted?.metadata?.ephemeralDuration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 });
	}
	
	haruka.profilePictureUrl = async (jid, type = 'image', timeoutMs) => {
		const result = await haruka.query({
			tag: 'iq',
			attrs: {
				target: jidNormalizedUser(jid),
				to: '@s.whatsapp.net',
				type: 'get',
				xmlns: 'w:profile:picture'
			},
			content: [{
				tag: 'picture',
				attrs: {
					type, query: 'url'
				},
			}]
		}, timeoutMs);
		const child = getBinaryNodeChild(result, 'picture');
		return child?.attrs?.url;
	}
	
	haruka.setStatus = (status) => {
		haruka.query({
			tag: 'iq',
			attrs: {
				to: '@s.whatsapp.net',
				type: 'set',
				xmlns: 'status',
			},
			content: [{
				tag: 'status',
				attrs: {},
				content: Buffer.from(status, 'utf-8')
			}]
		})
		return status
	}
	
	haruka.relayMessageV2 = async (jid, message, options) => {
		const msg = generateWAMessageFromContent(jid, message, {
			upload: haruka.waUploadToServer,
			messageId: generateMessageID(),
			...options
		});
		const hasil = await haruka.relayMessage(jid, msg.message, {
			messageId: msg.key.id,
			...options
		});
		return hasil;
	}

	haruka.sendPoll = (jid, name = '', values = [], quoted, selectableCount = 1) => {
		return haruka.sendMessage(jid, { poll: { name, values, selectableCount }}, { quoted, ephemeralExpiration: quoted?.expiration || quoted?.metadata?.ephemeralDuration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 })
	}
	
	haruka.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
		const quotedOptions = { quoted, ephemeralExpiration: quoted?.expiration || quoted?.metadata?.ephemeralDuration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 }
		try {
			const res = await axios.head(url);
			let mime = res.headers['content-type'];
			if (mime && mime.includes('gif')) {
				return haruka.sendMessage(jid, { video: { url }, caption: caption, gifPlayback: true, ...options }, quotedOptions);
			} else if (mime && mime === 'application/pdf') {
				return haruka.sendMessage(jid, { document: { url }, mimetype: 'application/pdf', caption: caption, ...options }, quotedOptions);
			} else if (mime && mime.includes('image')) {
				return haruka.sendMessage(jid, { image: { url }, caption: caption, ...options }, quotedOptions);
			} else if (mime && mime.includes('video')) {
				return haruka.sendMessage(jid, { video: { url }, caption: caption, mimetype: 'video/mp4', ...options }, quotedOptions);
			} else if (mime && mime.includes('audio')) {
				return haruka.sendMessage(jid, { audio: { url }, mimetype: 'audio/mpeg', ...options }, quotedOptions);
			} else {
				return haruka.sendMessage(jid, { document: { url }, caption: caption, mimetype: mime, ...options }, quotedOptions);
			}
		} catch (e) {
			return haruka.sendMessage(jid, { text: url, ...options }, quotedOptions);
		}
	}
	
	haruka.sendGroupInviteV4 = async (jid, participant, inviteCode, inviteExpiration, groupName = 'Unknown Subject', caption = 'Invitation to join my WhatsApp group', jpegThumbnail = null, options = {}) => {
		const msg = proto.Message.create({
			groupInviteMessage: {
				inviteCode,
				inviteExpiration: