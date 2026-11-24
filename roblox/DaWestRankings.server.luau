--[[ DaWestRankings
	Owns: the website rating sync. Reads each player's DaWest rating from the public lookup
	GET /api/v1/roblox/?ids=... (no key needed) and writes player attributes:
	  DaWestLinked (bool), DaWestRating, DaWestPeak, DaWestRank, DaWestTier, DaWestUsername,
	  DaWestTeamTag, DaWestWins, DaWestLosses, DaWestSynced (os.time of last good sync).
	Faction ratings: the player's in-game faction (FactionId), if its leader linked it to a site
	faction (GET /api/v1/roblox/factions/?ids=...), gives DaWestFactionLinked, DaWestFactionName,
	DaWestFactionTag, DaWestFactionRating, DaWestFactionRank, DaWestFactionTier, DaWestFactionUsername.
	Also publishes confirmed faction standings under ReplicatedStorage.DaWestRankings.FactionRatings
	so the Factions tab can show verification, global rank and Elo for every faction in this server.
	Refreshes: on join (batched), every REFRESH_SECONDS, after a KOH round is rated
	(KOHRankingsReporter sets KOHEloDelta), and on request from Settings (remote, rate limited).
	Needs Game Settings > Security > Allow HTTP Requests.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local API = "https://dawest-rankings.onrender.com/api/v1/roblox/?ids="
local FACTION_API = "https://dawest-rankings.onrender.com/api/v1/roblox/factions/?ids="
local SITE = "dawest-rankings.onrender.com"
local REFRESH_SECONDS = 300
local MANUAL_COOLDOWN = 30
local BATCH = 100

local folder = ReplicatedStorage:FindFirstChild("DaWestRankings") or Instance.new("Folder")
folder.Name = "DaWestRankings"
folder:SetAttribute("Site", SITE)
folder.Parent = ReplicatedStorage
local refreshRemote = folder:FindFirstChild("Refresh") or Instance.new("RemoteEvent")
refreshRemote.Name = "Refresh"
refreshRemote.Parent = folder
-- Server-owned public standings for every in-game faction represented in this server.
local factionRatings = folder:FindFirstChild("FactionRatings") or Instance.new("Folder")
factionRatings.Name = "FactionRatings"
factionRatings.Parent = folder

local FIELDS = { "DaWestRating", "DaWestPeak", "DaWestRank", "DaWestTier", "DaWestUsername", "DaWestTeamTag", "DaWestWins", "DaWestLosses" }

local function apply(plr, entry)
	if not plr.Parent then
		return
	end
	local linked = entry and entry.linked == true
	plr:SetAttribute("DaWestLinked", linked)
	if not linked then
		for _, f in FIELDS do
			plr:SetAttribute(f, nil)
		end
	else
		plr:SetAttribute("DaWestRating", entry.rating)
		plr:SetAttribute("DaWestPeak", entry.peak_rating)
		plr:SetAttribute("DaWestRank", entry.rank)
		plr:SetAttribute("DaWestTier", entry.tier)
		plr:SetAttribute("DaWestUsername", entry.username)
		plr:SetAttribute("DaWestTeamTag", entry.team_tag)
		plr:SetAttribute("DaWestWins", entry.wins)
		plr:SetAttribute("DaWestLosses", entry.losses)
	end
	plr:SetAttribute("DaWestSynced", os.time())
end

local FACTION_FIELDS = { DaWestFactionName = "display_name", DaWestFactionTag = "tag", DaWestFactionRating = "rating", DaWestFactionRank = "rank", DaWestFactionTier = "tier", DaWestFactionUsername = "username" }

local function applyFaction(plr, entry)
	if not plr.Parent then
		return
	end
	local linked = entry ~= nil and entry.linked == true
	plr:SetAttribute("DaWestFactionLinked", if plr:GetAttribute("FactionId") then linked else nil)
	for attr, key in FACTION_FIELDS do
		plr:SetAttribute(attr, if linked then entry[key] else nil)
	end
end

-- Site ratings of these players' in-game factions (one request for the whole list).
local function syncFactions()
	local list = Players:GetPlayers()
	local ids, seen = {}, {}
	for _, plr in list do
		local fid = plr.Parent and plr:GetAttribute("FactionId")
		if type(fid) == "string" and fid:match("^[%w_%-]+$") and not seen[fid] and #ids < 50 then
			seen[fid] = true
			table.insert(ids, fid)
		end
	end
	local found = {}
	if #ids > 0 then
		local ok, body = pcall(HttpService.GetAsync, HttpService, FACTION_API .. table.concat(ids, ","), true)
		if not ok then
			warn("[DaWestRankings] faction lookup failed:", body)
			return
		end
		local decoded, data = pcall(HttpService.JSONDecode, HttpService, body)
		if not (decoded and type(data) == "table" and type(data.factions) == "table") then
			return
		end
		found = data.factions
	end
	-- Publish only website-confirmed links. Removing a link removes its verified marker and rank.
	for _, record in factionRatings:GetChildren() do
		if not seen[record.Name] then
			record:Destroy()
		end
	end
	for _, fid in ids do
		local entry = found[fid]
		local record = factionRatings:FindFirstChild(fid)
		if entry and entry.linked == true then
			record = record or Instance.new("Folder")
			record.Name = fid
			record:SetAttribute("Verified", true)
			record:SetAttribute("Rank", tonumber(entry.rank))
			record:SetAttribute("Rating", tonumber(entry.rating))
			record:SetAttribute("Tier", entry.tier)
			record:SetAttribute("SiteName", entry.display_name)
			record.Parent = factionRatings
		elseif record then
			record:Destroy()
		end
	end
	for _, plr in list do
		local fid = plr.Parent and plr:GetAttribute("FactionId")
		applyFaction(plr, fid and found[fid] or nil)
	end
end

local function sync(list)
	for i = 1, #list, BATCH do
		local chunk, ids = {}, {}
		for j = i, math.min(i + BATCH - 1, #list) do
			local plr = list[j]
			if plr.Parent and plr.UserId > 0 then
				table.insert(chunk, plr)
				table.insert(ids, tostring(plr.UserId))
			end
		end
		if #ids > 0 then
			local ok, body = pcall(HttpService.GetAsync, HttpService, API .. table.concat(ids, ","), true)
			if ok then
				local decoded, data = pcall(HttpService.JSONDecode, HttpService, body)
				if decoded and type(data) == "table" and type(data.players) == "table" then
					for _, plr in chunk do
						apply(plr, data.players[tostring(plr.UserId)])
					end
				end
			else
				warn("[DaWestRankings] lookup failed (site asleep or HTTP off):", body)
			end
		end
	end
end

-- Joins are batched so a full server arriving at once costs one request.
local pending, scheduled = {}, false
local function queue(plr)
	pending[plr] = true
	if scheduled then
		return
	end
	scheduled = true
	task.delay(2, function()
		scheduled = false
		local list = {}
		for p in pending do
			table.insert(list, p)
		end
		pending = {}
		sync(list)
		syncFactions()
	end)
end

local function watch(plr)
	queue(plr)
	-- A rated KOH round changed this player's Elo on the site: pull the new number.
	plr:GetAttributeChangedSignal("KOHEloDelta"):Connect(function()
		queue(plr)
	end)
	-- DaWestAccountLink confirmed this account through the trusted game API.
	plr:GetAttributeChangedSignal("DaWestLinkConfirmedAt"):Connect(function()
		queue(plr)
	end)
	-- joined / left / switched faction: re-read its site rating
	plr:GetAttributeChangedSignal("FactionId"):Connect(function()
		queue(plr)
	end)
end

-- a leader just linked their faction (FactionService.LinkSite): refresh everyone's faction rating
folder:GetAttributeChangedSignal("FactionLinkedAt"):Connect(function()
	syncFactions()
end)
Players.PlayerAdded:Connect(watch)
for _, plr in Players:GetPlayers() do
	watch(plr)
end

local lastManual = {}
refreshRemote.OnServerEvent:Connect(function(plr)
	local now = os.clock()
	if lastManual[plr] and now - lastManual[plr] < MANUAL_COOLDOWN then
		return
	end
	lastManual[plr] = now
	queue(plr)
end)
Players.PlayerRemoving:Connect(function(plr)
	lastManual[plr] = nil
	pending[plr] = nil
end)

task.spawn(function()
	while true do
		task.wait(REFRESH_SECONDS)
		sync(Players:GetPlayers())
		syncFactions()
	end
end)
