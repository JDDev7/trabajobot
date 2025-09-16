const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const mongoose = require("mongoose");
const schedule = require('node-schedule');
require("dotenv").config();


function formatHours(decimalHours) {
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return `${hours}h ${minutes}m`;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});


mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Conectado a MongoDB"))
  .catch((err) => console.error("Error conectando a MongoDB:", err));


const workSessionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  duration: { type: Number }, 
});
const WorkSession = mongoose.model("WorkSession", workSessionSchema);

// Esquema para configuraciones del servidor
const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  logChannelId: { type: String, default: null },
  adminLogChannelId: { type: String, default: null },
  weeklySummaryChannelId: { type: String, default: null }
});
const GuildConfig = mongoose.model("GuildConfig", guildConfigSchema);


const activeSessions = new Map();


async function getGuildConfig(guildId) {
  try {
    let config = await GuildConfig.findOne({ guildId });
    if (!config) {
      // Crear configuración por defecto si no existe
      config = new GuildConfig({ guildId });
      await config.save();
    }
    return config;
  } catch (error) {
    console.error("Error obteniendo configuración:", error);
    return { logChannelId: null, adminLogChannelId: null, weeklySummaryChannelId: null };
  }
}

client.once("ready", async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  

  const job = schedule.scheduleJob('0 10 * * 1', async function() {
    console.log('Ejecutando tarea programada: resumen semanal');
    

    const configs = await GuildConfig.find({ 
      weeklySummaryChannelId: { $ne: null } 
    });
    
    for (const config of configs) {
      try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) continue;
        
        const channel = guild.channels.cache.get(config.weeklySummaryChannelId);
        if (!channel) {
          console.log(`No se encontró el canal de resumen semanal para el servidor ${guild.name}`);
          continue;
        }
        

        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - 7); 
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(now);
        endOfWeek.setHours(10, 0, 0, 0);
        

        const formatDate = (date) => {
          return date.toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'long'
          }).toUpperCase();
        };
        
        const startDateStr = formatDate(startOfWeek);
        const endDateStr = formatDate(endOfWeek);
        const month = endOfWeek.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase();
        

        const sessions = await WorkSession.find({ guildId: config.guildId });
        

        const userTotals = {};
        sessions.forEach(session => {
          if (!userTotals[session.userId]) {
            userTotals[session.userId] = 0;
          }
          userTotals[session.userId] += session.duration;
        });
        

        const embed = new EmbedBuilder()
          .setTitle(`SEMANA DEL ${startDateStr} AL ${endDateStr} DE ${month}`)
          .setColor(0x0099FF)
          .setDescription('Resumen de horas trabajadas esta semana:')
          .setTimestamp();
        
        // Añadir campos para cada usuario
        for (const [userId, totalHours] of Object.entries(userTotals)) {
          try {
            const user = await client.users.fetch(userId);
            const formattedHours = formatHours(totalHours);
            embed.addFields({
              name: user.username,
              value: formattedHours,
              inline: true
            });
          } catch (error) {
            console.error(`Error obteniendo usuario ${userId}:`, error);
          }
        }
        

        await channel.send({ embeds: [embed] });
        
        console.log(`Resumen semanal enviado para el servidor ${guild.name}. Reiniciando totales en 2 minutos...`);
        

        setTimeout(async () => {
          try {

            await WorkSession.deleteMany({ guildId: config.guildId });
            console.log(`Todos los registros de trabajo han sido reiniciados para el servidor ${guild.name}.`);
            

            await channel.send('✅ **Todos los totales han sido reiniciados para la nueva semana.**');
          } catch (error) {
            console.error(`Error reiniciando los totales para el servidor ${guild.name}:`, error);
          }
        }, 2 * 60 * 1000); // 2 minutos
      } catch (error) {
        console.error(`Error procesando servidor ${config.guildId}:`, error);
      }
    }
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;


  if (message.content.startsWith("!setlogchannel")) {
    if (!message.member.permissions.has("ADMINISTRATOR")) {
      return message.reply("No tienes permisos para usar este comando.");
    }
    
    try {
      await GuildConfig.findOneAndUpdate(
        { guildId: message.guild.id },
        { logChannelId: message.channel.id },
        { upsert: true, new: true }
      );
      
      message.reply(`Canal de logs establecido: <#${message.channel.id}>`);
    } catch (error) {
      console.error("Error guardando configuración:", error);
      message.reply("Ocurrió un error al guardar la configuración.");
    }
  }


  if (message.content.startsWith("!setadminlogchannel")) {
    if (!message.member.permissions.has("ADMINISTRATOR")) {
      return message.reply("No tienes permisos para usar este comando.");
    }
    
    try {
      await GuildConfig.findOneAndUpdate(
        { guildId: message.guild.id },
        { adminLogChannelId: message.channel.id },
        { upsert: true, new: true }
      );
      
      message.reply(`Canal de logs de administración establecido: <#${message.channel.id}>`);
    } catch (error) {
      console.error("Error guardando configuración:", error);
      message.reply("Ocurrió un error al guardar la configuración.");
    }
  }


  if (message.content.startsWith("!setweeklysummary")) {
    if (!message.member.permissions.has("ADMINISTRATOR")) {
      return message.reply("No tienes permisos para usar este comando.");
    }
    
    try {
      await GuildConfig.findOneAndUpdate(
        { guildId: message.guild.id },
        { weeklySummaryChannelId: message.channel.id },
        { upsert: true, new: true }
      );
      
      message.reply(`Canal de resumen semanal establecido: <#${message.channel.id}>`);
    } catch (error) {
      console.error("Error guardando configuración:", error);
      message.reply("Ocurrió un error al guardar la configuración.");
    }
  }


  if (message.content.startsWith("!panel")) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("fichar")
        .setLabel("Fichar")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("salir")
        .setLabel("Salir")
        .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
      .setTitle("Control de Trabajo")
      .setDescription(
        'Haz clic en "Fichar" para comenzar a contar tu tiempo de trabajo. Haz clic en "Salir" para finalizar.'
      );

    message.channel.send({ embeds: [embed], components: [row] });
  }


  if (message.content.startsWith("!status")) {
    if (!message.member.permissions.has("ADMINISTRATOR")) {
      return message.reply("No tienes permisos para usar este comando.");
    }
    
    if (activeSessions.size === 0) {
      return message.reply("No hay usuarios fichados actualmente.");
    }
    
    let statusMessage = "**Usuarios fichados actualmente:**\n";
    activeSessions.forEach((startTime, userId) => {
      const user = client.users.cache.get(userId);
      const durationMs = Date.now() - startTime;
      const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2);
      const formattedDuration = formatHours(parseFloat(durationHours));
      
      statusMessage += `- ${user ? user.tag : userId} (desde ${startTime.toLocaleTimeString()}, ${formattedDuration})\n`;
    });
    
    message.reply(statusMessage);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user, guild } = interaction;
  const config = await getGuildConfig(guild.id);

  if (customId === "fichar") {
    if (activeSessions.has(user.id)) {
      return interaction.reply({
        content: "Ya tienes una sesión de trabajo activa.",
        ephemeral: true,
      });
    }

    const startTime = new Date();
    activeSessions.set(user.id, startTime);

    // Enviar mensaje al canal de administración
    if (config.adminLogChannelId) {
      const adminLogChannel = guild.channels.cache.get(config.adminLogChannelId);
      if (adminLogChannel) {
        const adminEmbed = new EmbedBuilder()
          .setTitle('Inicio de Sesión de Trabajo')
          .setDescription(`**Usuario:** ${user.displayName}\n**Inicio:** ${startTime.toLocaleString()}`)
          .setColor(0x00AE86)
          .setFooter({ text: `ID: ${user.id}` });
        adminLogChannel.send({ embeds: [adminEmbed] });
      }
    }

    await interaction.reply({
      content: `¡Sesión de trabajo iniciada a las ${startTime.toLocaleTimeString()}!`,
      ephemeral: true,
    });
  } else if (customId === "salir") {
    if (!activeSessions.has(user.id)) {
      return interaction.reply({
        content: "No tienes una sesión de trabajo activa.",
        ephemeral: true,
      });
    }

    const startTime = activeSessions.get(user.id);
    const endTime = new Date();
    const durationMs = endTime - startTime;
    const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2); // Convertir a horas

    // Guardar en MongoDB
    const newSession = new WorkSession({
      userId: user.id,
      guildId: guild.id,
      startTime: startTime,
      endTime: endTime,
      duration: parseFloat(durationHours), 
    });

    await newSession.save();
    activeSessions.delete(user.id);

    const userSessions = await WorkSession.find({
      userId: user.id,
      guildId: guild.id,
    });
    let totalHours = 0;
    userSessions.forEach((session) => {
      totalHours += session.duration;
    });

    const formattedTotal = totalHours.toFixed(2);
    

    const formattedDuration = formatHours(parseFloat(durationHours));
    const formattedTotalTime = formatHours(totalHours);

    // Enviar embed ephemeral al usuario con el resumen
    const summaryEmbed = new EmbedBuilder()
      .setTitle('Resumen de tu Sesión de Trabajo')
      .setDescription(`**Duración de esta sesión:** ${formattedDuration}\n**Fin:** ${endTime.toLocaleString()}`)
      .setColor(0x00AE86);

    await interaction.reply({ 
      embeds: [summaryEmbed],
      ephemeral: true 
    });


    if (config.adminLogChannelId) {
      const adminLogChannel = guild.channels.cache.get(config.adminLogChannelId);
      if (adminLogChannel) {
          const adminEmbed = new EmbedBuilder()
              .setTitle('Fin de Sesión de Trabajo')
              .setDescription(`**Usuario:** ${user.displayName}\n**Duración:** ${formattedDuration}\n**Total acumulado:** ${formattedTotalTime}\n**Fin:** ${endTime.toLocaleString()}`)
              .setColor(0x00AE86)
              .setFooter({ text: `ID: ${user.id}` });
          adminLogChannel.send({ embeds: [adminEmbed] });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);