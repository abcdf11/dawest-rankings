--[[
	ModuleScript — CombatClient > FactionController

	The faction menu (U, or the shield button above the player list). Three tabs:
	  Members   your faction's members and ranks, invite (with autocomplete from this server),
	            join requests (leader / officers), promote / demote / kick, leave or disband.
	            Without a faction: your invites and a shortcut to create one.
	  Settings  name, tag, logo (decal id), hide logo, friendly fire, join requests. Leader only;
	            everyone else sees them read-only.
	  Factions  every faction in this server (logo, tag, name, members); verified linked factions
	            show their global rank and Elo. Details on click; join
	            requests; Create Faction when you have none.
	The client only ASKS: every change goes through ReplicatedStorage.Factions.Remotes.Request and the
	server decides (ServerScriptService > FactionServer). The view refreshes from Remotes.Sync.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local CollectionService = game:GetService("CollectionService")
local UserInputService = game:GetService("UserInputService")

local Factions = ReplicatedStorage:WaitForChild("Factions")
local FC = require(Factions:WaitForChild("FactionConfig"))
local FactionIcons = require(Factions:WaitForChild("FactionIcons"))
local MovementConfig = require(ReplicatedStorage:WaitForChild("Combat"):WaitForChild("MovementConfig"))
local Names = require(ReplicatedStorage:WaitForChild("Customization"):WaitForChild("Names"))

-- the gun HUD's palette
local GOLD = Color3.fromRGB(198, 200, 204)
local CREAM = Color3.fromRGB(236, 232, 224)
local DIM = Color3.fromRGB(146, 143, 137)
local PANEL = Color3.fromRGB(12, 12, 13)
local FIELD = Color3.fromRGB(22, 22, 24)
local LINE = Color3.fromRGB(44, 44, 47)
local RED = Color3.fromRGB(150, 40, 50)

local BOLD = Enum.Font.BuilderSansBold
local MED = Enum.Font.BuilderSansMedium

local WIDTH, MAX_HEIGHT = 380, 540
local TABS = { "Members", "Settings", "Factions" }
local RANK_ORDER = { Leader = 3, Officer = 2, Member = 1 }

local FactionController = {}
local Ctx
local player = Players.LocalPlayer
local Request, Sync, Notify
local state = nil
local ui = { pages = {}, tabButtons = {} }
local isOpen = false
local currentTab = "Members"
local expanded = {} -- member userId / faction id -> true (row details open)
local confirmAt = {} -- action -> os.clock() of the first click
local seenInvites = {}

----------------------------------------------------------------------------------------------
-- ui helpers
----------------------------------------------------------------------------------------------
local function new(className, props, parent)
	local inst = Instance.new(className)
	for k, v in props do
		inst[k] = v
	end
	inst.Parent = parent
	return inst
end
local function corner(obj, r)
	return new("UICorner", { CornerRadius = UDim.new(0, r or 2) }, obj)
end
local function stroke(obj, color, transparency)
	return new("UIStroke", { Color = color or GOLD, Transparency = transparency or 0.8, Thickness = 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, obj)
end
local function tween(obj, t, props)
	local tw = TweenService:Create(obj, TweenInfo.new(t, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), props)
	tw:Play()
	return tw
end
local function text(parent, props)
	local p = {
		BackgroundTransparency = 1, Font = MED, TextSize = 13, TextColor3 = CREAM,
		TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd,
	}
	for k, v in props do
		p[k] = v
	end
	return new("TextLabel", p, parent)
end
-- "[TAG] Name", or just "Name" when the faction has no tag
local function tagged(tag, name)
	if type(tag) == "string" and tag ~= "" then
		return ("[%s] %s"):format(tag, name)
	end
	return name
end
local function sectionTitle(parent, label, order)
	return text(parent, { Size = UDim2.new(1, 0, 0, 22), Font = BOLD, TextSize = 10, TextColor3 = DIM, Text = label, LayoutOrder = order })
end

-- style: "primary" (gold outline), "ghost" (quiet), "danger"
local function button(parent, label, style, size, order)
	local b = new("TextButton", {
		Size = size or UDim2.fromOffset(84, 28), AutoButtonColor = false, LayoutOrder = order or 0,
		BackgroundColor3 = if style == "primary" then FIELD else PANEL, BackgroundTransparency = if style == "ghost" then 1 else 0,
		Font = BOLD, TextSize = 12, Text = label,
		TextColor3 = if style == "danger" then RED elseif style == "ghost" then DIM else CREAM,
	}, parent)
	corner(b)
	local s = stroke(b, if style == "danger" then RED else GOLD, if style == "primary" then 0.45 elseif style == "danger" then 0.55 else 0.85)
	local base = s.Transparency
	b.MouseEnter:Connect(function()
		if b.Active then
			tween(s, 0.12, { Transparency = math.max(base - 0.3, 0) })
		end
	end)
	b.MouseLeave:Connect(function()
		tween(s, 0.12, { Transparency = base })
	end)
	return b
end
local function setEnabled(b, on)
	b.Active = on
	b.AutoButtonColor = false
	b.TextTransparency = if on then 0 else 0.55
	local s = b:FindFirstChildOfClass("UIStroke")
	if s then
		s.Enabled = on
	end
end
local function textbox(parent, placeholder, size, order, maxLen)
	local box = new("TextBox", {
		Size = size or UDim2.new(1, -92, 0, 28), LayoutOrder = order or 0, BackgroundColor3 = FIELD,
		Font = MED, TextSize = 13, TextColor3 = CREAM, PlaceholderText = placeholder, PlaceholderColor3 = DIM,
		Text = "", ClearTextOnFocus = false, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd,
	}, parent)
	corner(box)
	stroke(box, LINE, 0)
	new("UIPadding", { PaddingLeft = UDim.new(0, 9), PaddingRight = UDim.new(0, 9) }, box)
	if maxLen then
		box:GetPropertyChangedSignal("Text"):Connect(function()
			if #box.Text > maxLen then
				box.Text = box.Text:sub(1, maxLen)
			end
		end)
	end
	return box
end
local function row(parent, height, order)
	local f = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, height), LayoutOrder = order or 0 }, parent)
	new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, f)
	return f
end
local function clear(container)
	for _, c in container:GetChildren() do
		if c:IsA("GuiObject") then
			c:Destroy()
		end
	end
end

----------------------------------------------------------------------------------------------
-- toasts
----------------------------------------------------------------------------------------------
local function toast(message, kind, buttons, life)
	if not ui.toasts or not message or message == "" then
		return
	end
	local t = new("CanvasGroup", {
		Size = UDim2.fromOffset(300, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = PANEL,
		BackgroundTransparency = 0.08, GroupTransparency = 1, LayoutOrder = -math.floor(os.clock() * 100),
	}, ui.toasts)
	corner(t, 2)
	stroke(t, if kind == "error" then RED else GOLD, 0.7)
	new("UIPadding", { PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12), PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8) }, t)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6) }, t)
	text(t, {
		Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextWrapped = true, TextTruncate = Enum.TextTruncate.None,
		Text = message, TextColor3 = if kind == "error" then RED else CREAM, LayoutOrder = 1,
	})
	local function close()
		if t.Parent then
			tween(t, 0.2, { GroupTransparency = 1 }).Completed:Connect(function()
				t:Destroy()
			end)
		end
	end
	if buttons then
		local r = row(t, 26, 2)
		for i, b in buttons do
			local btn = button(r, b.label, b.style, UDim2.fromOffset(84, 26), i)
			btn.Activated:Connect(function()
				close()
				b.callback()
			end)
		end
	end
	tween(t, 0.2, { GroupTransparency = 0 })
	task.delay(life or 3.5, close)
	-- keep at most 4
	local list = {}
	for _, c in ui.toasts:GetChildren() do
		if c:IsA("CanvasGroup") then
			table.insert(list, c)
		end
	end
	table.sort(list, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	for i = 5, #list do
		list[i]:Destroy()
	end
end

----------------------------------------------------------------------------------------------
-- server requests
----------------------------------------------------------------------------------------------
local function send(action, args, done)
	task.spawn(function()
		local ok, res = pcall(Request.InvokeServer, Request, action, args or {})
		if not ok or type(res) ~= "table" then
			toast("Couldn't reach the server.", "error")
			return
		end
		if res.msg then
			toast(res.msg, if res.ok then "info" else "error")
		end
		if done then
			done(res)
		end
	end)
end

-- two clicks within 3 s for anything destructive
local function confirm(id, b, label)
	if confirmAt[id] and os.clock() - confirmAt[id] < 3 then
		confirmAt[id] = nil
		return true
	end
	confirmAt[id] = os.clock()
	local old = b.Text
	b.Text = label or "Confirm?"
	task.delay(3, function()
		if b.Parent and b.Text == (label or "Confirm?") then
			b.Text = old
		end
	end)
	return false
end

local function price(product)
	if state and state.testing then
		return "Free"
	end
	return "R$" .. FC.Products[product].Price
end

----------------------------------------------------------------------------------------------
-- header (your faction)
----------------------------------------------------------------------------------------------

-- Public website standings are written by DaWestRankings on the server, keyed by faction ID.
local function siteFaction(id)
	local root = ReplicatedStorage:FindFirstChild("DaWestRankings")
	local ratings = root and root:FindFirstChild("FactionRatings")
	local record = ratings and id and ratings:FindFirstChild(id)
	if not (record and record:GetAttribute("Verified") == true) then
		return nil
	end
	return {
		rank = tonumber(record:GetAttribute("Rank")),
		rating = tonumber(record:GetAttribute("Rating")),
		tier = tostring(record:GetAttribute("Tier") or ""),
	}
end

local function siteRank(ranking)
	return if ranking.rank and ranking.rank > 0 then ("#%d global"):format(ranking.rank) else "Unranked"
end

local function siteStanding(ranking)
	local rank = siteRank(ranking)
	return if ranking.rating then ("%s  ·  %d Elo"):format(rank, ranking.rating) else rank
end

local function renderHeader()
	local mine = state and state.mine
	local h = ui.header
	FactionIcons.SetLogo(h.logo, mine and mine.logo or "", true)
	h.logo.Star.TextColor3 = if mine then CREAM else DIM
	h.name.Text = if mine then mine.name else "No faction"
	h.sub.Text = if mine then (if mine.tag then ("[%s]  ·  %s"):format(mine.tag, mine.myRank) else mine.myRank) else "Create or join one below"
	h.count.Visible = mine ~= nil
	h.slots.Visible = mine ~= nil
	h.ranking.Visible = mine ~= nil
	local ranking = mine and siteFaction(mine.id)
	h.ranking.Text = if ranking then "✓ Verified faction  ·  " .. siteStanding(ranking) else "Not linked to DaWest Rankings"
	h.ranking.TextColor3 = if ranking then Color3.fromRGB(183, 213, 245) else DIM
	if mine then
		h.count.Text = ("%d/%d"):format(mine.count, mine.capacity)
		h.slots.Text = ("+%d slots · %s"):format(FC.SlotsPerUpgrade, price("SlotUpgrade"))
		setEnabled(h.slots, mine.capacity < mine.maxCapacity)
	end
end

----------------------------------------------------------------------------------------------
-- Members tab
----------------------------------------------------------------------------------------------
local function candidates(prefix)
	prefix = prefix:lower()
	local list = {}
	if prefix == "" then
		return list
	end
	for _, p in Players:GetPlayers() do
		if p ~= player and not p:GetAttribute("FactionId") then
			local n, d = p.Name:lower(), p.DisplayName:lower()
			if n:sub(1, #prefix) == prefix or d:sub(1, #prefix) == prefix then
				table.insert(list, p)
			end
		end
	end
	table.sort(list, function(a, b)
		return a.Name:lower() < b.Name:lower()
	end)
	return list
end

local function renderSuggestions()
	local m = ui.members
	clear(m.suggest)
	local list = candidates(m.invite.Text)
	local exact = false
	for _, p in list do
		if p.Name:lower() == m.invite.Text:lower() then
			exact = true
		end
	end
	m.suggest.Visible = m.invite:IsFocused() and #list > 0 and not (exact and #list == 1)
	for i = 1, math.min(#list, 5) do
		local p = list[i]
		local b = new("TextButton", {
			Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1, AutoButtonColor = false, LayoutOrder = i,
			Font = MED, TextSize = 12, TextColor3 = CREAM, TextXAlignment = Enum.TextXAlignment.Left,
			Text = if p.DisplayName ~= p.Name then p.Name .. "  (" .. p.DisplayName .. ")" else p.Name,
		}, m.suggest)
		new("UIPadding", { PaddingLeft = UDim.new(0, 9) }, b)
		b.MouseEnter:Connect(function()
			b.TextColor3 = GOLD
		end)
		b.MouseLeave:Connect(function()
			b.TextColor3 = CREAM
		end)
		b.Activated:Connect(function()
			m.invite.Text = p.Name
			m.suggest.Visible = false
		end)
	end
end

local function inviteTarget(textIn)
	local q = textIn:lower()
	for _, p in Players:GetPlayers() do
		if p.Name:lower() == q then
			return p
		end
	end
	local list = candidates(textIn)
	if #list == 1 then
		return list[1]
	end
	return nil
end

local function memberRow(container, m, mine, order)
	local myRank = RANK_ORDER[mine.myRank] or 0
	local theirs = RANK_ORDER[m.rank] or 0
	local isMe = m.userId == player.UserId
	local actions = {}
	if not isMe then
		if mine.myRank == "Leader" then
			if m.rank == "Member" then
				table.insert(actions, { "Promote", "primary", function()
					send("SetRank", { userId = m.userId, rank = "Officer" })
				end })
			elseif m.rank == "Officer" then
				table.insert(actions, { "Demote", "ghost", function()
					send("SetRank", { userId = m.userId, rank = "Member" })
				end })
			end
			table.insert(actions, { "Make leader", "ghost", function(b)
				if confirm("lead" .. m.userId, b) then
					send("SetRank", { userId = m.userId, rank = "Leader" })
				end
			end })
		end
		if myRank > theirs and myRank >= 2 then
			table.insert(actions, { "Kick", "danger", function(b)
				if confirm("kick" .. m.userId, b) then
					send("Kick", { userId = m.userId })
				end
			end })
		end
	end

	local wrap = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = order }, container)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder }, wrap)
	local r = new("TextButton", {
		Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = FIELD, BackgroundTransparency = 0.35, AutoButtonColor = false, Text = "", LayoutOrder = 1,
	}, wrap)
	corner(r)
	new("Frame", {
		AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 10, 0.5, 0), Size = UDim2.fromOffset(6, 6),
		BackgroundColor3 = if m.online then CREAM else DIM, BackgroundTransparency = if m.online then 0.1 else 0.6,
	}, r).Name = "Dot"
	corner(r:FindFirstChild("Dot"), 3)
	-- online members show "◈ CustomName" (hover: the username); offline ones their username
	local online = Names.ByUserId(m.userId)
	local shownName = if online then Names.Shown(online) else m.name
	local nameLabel = text(r, {
		Position = UDim2.fromOffset(24, 0), Size = UDim2.new(1, -120, 1, 0), Text = shownName,
		TextColor3 = if isMe then GOLD else CREAM,
	})
	if online and shownName ~= online.Name then
		nameLabel.MouseEnter:Connect(function()
			nameLabel.Text = online.Name
		end)
		nameLabel.MouseLeave:Connect(function()
			nameLabel.Text = shownName
		end)
	end
	text(r, {
		AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 0), Size = UDim2.new(0, 90, 1, 0),
		TextXAlignment = Enum.TextXAlignment.Right, Font = BOLD, TextSize = 11, Text = m.rank,
		TextColor3 = if m.rank == "Leader" then GOLD else DIM,
	})
	if #actions > 0 then
		local strip = new("Frame", {
			BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 34), LayoutOrder = 2, Visible = expanded[m.userId] == true,
		}, wrap)
		new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Right, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, strip)
		for i, a in actions do
			local b = button(strip, a[1], a[2], UDim2.fromOffset(if a[1] == "Make leader" then 92 else 70, 24), i)
			b.Activated:Connect(function()
				a[3](b)
			end)
		end
		r.Activated:Connect(function()
			expanded[m.userId] = not expanded[m.userId]
			strip.Visible = expanded[m.userId]
		end)
	end
end

local function renderMembers()
	local m = ui.members
	local mine = state and state.mine
	m.inFaction.Visible = mine ~= nil
	m.noFaction.Visible = mine == nil
	clear(m.list)
	clear(m.requests)
	clear(m.invites)
	if mine then
		local canManage = (RANK_ORDER[mine.myRank] or 0) >= 2
		m.inviteRow.Visible = canManage
		m.membersTitle.Text = ("MEMBERS  %d/%d"):format(mine.count, mine.capacity)
		for i, mem in mine.members do
			memberRow(m.list, mem, mine, i)
		end
		m.requestsTitle.Visible = canManage and #mine.requests > 0
		m.requestsTitle.Text = ("JOIN REQUESTS  %d"):format(#mine.requests)
		if canManage then
			for i, req in mine.requests do
				local r = new("Frame", { Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = FIELD, BackgroundTransparency = 0.35, LayoutOrder = i }, m.requests)
				corner(r)
				text(r, { Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -170, 1, 0), Text = req.name })
				local holder = new("Frame", { AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -4, 0.5, 0), Size = UDim2.fromOffset(150, 24), BackgroundTransparency = 1 }, r)
				new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Right, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, holder)
				local yes = button(holder, "Accept", "primary", UDim2.fromOffset(70, 24), 1)
				local no = button(holder, "Reject", "ghost", UDim2.fromOffset(64, 24), 2)
				yes.Activated:Connect(function()
					send("AnswerRequest", { userId = req.userId, accept = true })
				end)
				no.Activated:Connect(function()
					send("AnswerRequest", { userId = req.userId, accept = false })
				end)
			end
		end
		local leader = mine.myRank == "Leader"
		m.leave.Text = if leader then "Disband faction" else "Leave faction"
	else
		m.invitesTitle.Visible = state ~= nil and #state.invites > 0
		for i, inv in (state and state.invites or {}) do
			local r = new("Frame", { Size = UDim2.new(1, 0, 0, 44), BackgroundColor3 = FIELD, BackgroundTransparency = 0.35, LayoutOrder = i }, m.invites)
			corner(r)
			text(r, { Position = UDim2.fromOffset(10, 5), Size = UDim2.new(1, -170, 0, 18), Text = tagged(inv.tag, inv.name) })
			text(r, { Position = UDim2.fromOffset(10, 22), Size = UDim2.new(1, -170, 0, 16), TextSize = 11, TextColor3 = DIM, Text = "from " .. inv.from })
			local holder = new("Frame", { AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -4, 0.5, 0), Size = UDim2.fromOffset(150, 24), BackgroundTransparency = 1 }, r)
			new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Right, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, holder)
			local yes = button(holder, "Join", "primary", UDim2.fromOffset(64, 24), 1)
			local no = button(holder, "Decline", "ghost", UDim2.fromOffset(70, 24), 2)
			yes.Activated:Connect(function()
				send("AnswerInvite", { faction = inv.faction, accept = true })
			end)
			no.Activated:Connect(function()
				send("AnswerInvite", { faction = inv.faction, accept = false })
			end)
		end
	end
end

local function buildMembers(page)
	local m = {}
	ui.members = m
	local scroll = new("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollBarThickness = 2, ScrollBarImageColor3 = GOLD,
	}, page)
	new("UIPadding", { PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16), PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 16) }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6) }, scroll)

	-- in a faction
	local inF = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 1 }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6) }, inF)
	m.inFaction = inF
	m.inviteRow = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 28), LayoutOrder = 1, ZIndex = 5 }, inF)
	m.invite = textbox(m.inviteRow, "Invite a player…", UDim2.new(1, -92, 1, 0), 1, 20)
	m.invite.ZIndex = 5
	local inviteBtn = button(m.inviteRow, "Invite", "primary", UDim2.new(0, 84, 1, 0), 2)
	inviteBtn.Position = UDim2.new(1, -84, 0, 0)
	m.suggest = new("Frame", {
		Position = UDim2.new(0, 0, 1, 4), Size = UDim2.new(1, -92, 0, 0), AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = FIELD, Visible = false, ZIndex = 20,
	}, m.inviteRow)
	corner(m.suggest)
	stroke(m.suggest, GOLD, 0.75)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder }, m.suggest)
	m.invite:GetPropertyChangedSignal("Text"):Connect(renderSuggestions)
	m.invite.Focused:Connect(renderSuggestions)
	m.invite.FocusLost:Connect(function()
		task.delay(0.15, function()
			m.suggest.Visible = false
		end)
	end)
	local function doInvite()
		local p = inviteTarget(m.invite.Text)
		if not p then
			toast(if m.invite.Text == "" then "Type a username." else "No player by that name here (or they're in a faction).", "error")
			return
		end
		send("Invite", { userId = p.UserId }, function(res)
			if res.ok then
				m.invite.Text = ""
			end
		end)
	end
	inviteBtn.Activated:Connect(doInvite)
	m.invite.FocusLost:Connect(function(enter)
		if enter then
			doInvite()
		end
	end)

	m.membersTitle = sectionTitle(inF, "MEMBERS", 2)
	m.list = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 3 }, inF)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }, m.list)
	m.requestsTitle = sectionTitle(inF, "JOIN REQUESTS", 4)
	m.requests = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 5 }, inF)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }, m.requests)
	new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 10), LayoutOrder = 6 }, inF)
	m.leave = button(inF, "Leave faction", "danger", UDim2.new(1, 0, 0, 30), 7)
	m.leave.Activated:Connect(function()
		local mine = state and state.mine
		if not mine then
			return
		end
		if mine.myRank == "Leader" then
			if confirm("disband", m.leave, "Click again to disband") then
				send("Disband")
			end
		elseif confirm("leave", m.leave, "Click again to leave") then
			send("Leave")
		end
	end)

	-- no faction
	local noF = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 2 }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 8) }, noF)
	m.noFaction = noF
	text(noF, { Size = UDim2.new(1, 0, 0, 20), TextColor3 = DIM, Text = "You're not in a faction.", LayoutOrder = 1 })
	local go = button(noF, "Create a faction", "primary", UDim2.new(1, 0, 0, 32), 2)
	go.Activated:Connect(function()
		FactionController.ShowTab("Factions")
		if ui.factions.createName then
			ui.factions.createName:CaptureFocus()
		end
	end)
	m.invitesTitle = sectionTitle(noF, "INVITES", 3)
	m.invites = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 4 }, noF)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }, m.invites)
end

----------------------------------------------------------------------------------------------
-- Settings tab
----------------------------------------------------------------------------------------------
local function toggleRow(parent, label, desc, order, onClick)
	local r = new("TextButton", { Size = UDim2.new(1, 0, 0, 40), BackgroundTransparency = 1, Text = "", AutoButtonColor = false, LayoutOrder = order }, parent)
	text(r, { Size = UDim2.new(1, -50, 0, 18), Position = UDim2.fromOffset(0, 3), Text = label })
	text(r, { Size = UDim2.new(1, -50, 0, 14), Position = UDim2.fromOffset(0, 21), TextSize = 11, TextColor3 = DIM, Text = desc })
	local pill = new("Frame", { AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, 0, 0.5, 0), Size = UDim2.fromOffset(34, 18), BackgroundColor3 = FIELD }, r)
	corner(pill, 9)
	local ps = stroke(pill, LINE, 0)
	local knob = new("Frame", { AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 3, 0.5, 0), Size = UDim2.fromOffset(12, 12), BackgroundColor3 = DIM }, pill)
	corner(knob, 2)
	r.Activated:Connect(function()
		if r.Active then
			onClick()
		end
	end)
	local t = { button = r, value = nil }
	function t.set(on, enabled)
		r.Active = enabled
		if t.value ~= on then
			t.value = on
			tween(knob, 0.15, { Position = if on then UDim2.new(1, -15, 0.5, 0) else UDim2.new(0, 3, 0.5, 0), BackgroundColor3 = if on then PANEL else DIM })
			tween(pill, 0.15, { BackgroundColor3 = if on then GOLD else FIELD })
		end
		ps.Transparency = if enabled then 0 else 0.6
		pill.BackgroundTransparency = if enabled then 0 else 0.5
	end
	return t
end

local function fieldRow(parent, label, placeholder, order, maxLen, buttonLabel, onSave)
	sectionTitle(parent, label, order)
	local r = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 28), LayoutOrder = order + 1 }, parent)
	local box = textbox(r, placeholder, UDim2.new(1, -92, 1, 0), 1, maxLen)
	local b = button(r, buttonLabel or "Save", "primary", UDim2.new(0, 84, 1, 0), 2)
	b.Position = UDim2.new(1, -84, 0, 0)
	b.Activated:Connect(function()
		if b.Active then
			onSave(box, b)
		end
	end)
	box.FocusLost:Connect(function(enter)
		if enter and b.Active then
			onSave(box, b)
		end
	end)
	return box, b
end

local function buildSettings(page)
	local s = {}
	ui.settings = s
	local scroll = new("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollBarThickness = 2, ScrollBarImageColor3 = GOLD,
	}, page)
	new("UIPadding", { PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16), PaddingTop = UDim.new(0, 10), PaddingBottom = UDim.new(0, 16) }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }, scroll)
	s.none = text(scroll, { Size = UDim2.new(1, 0, 0, 24), TextColor3 = DIM, Text = "Join or create a faction to see its settings.", LayoutOrder = 0 })
	s.note = text(scroll, { Size = UDim2.new(1, 0, 0, 20), TextColor3 = DIM, TextSize = 11, Text = "Only the leader can change these.", LayoutOrder = 1 })
	s.body = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 2 }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }, s.body)

	s.name, s.nameBtn = fieldRow(s.body, "FACTION NAME", "Name", 10, FC.NameMax, "Save", function(box)
		send("SetName", { name = box.Text }, function(res)
			if res.ok then
				box.Text = ""
			end
		end)
	end)
	s.tag, s.tagBtn = fieldRow(s.body, ("FACTION TAG  (%d-%d, OPTIONAL · SAVE EMPTY TO REMOVE)"):format(FC.TagMin, FC.TagMax), "No tag", 20, FC.TagMax, "Save", function(box)
		send("SetTag", { tag = box.Text }, function(res)
			if res.ok then
				box.Text = ""
			end
		end)
	end)
	s.logo, s.logoBtn = fieldRow(s.body, "FACTION LOGO  (DECAL ID)", "Decal ID", 30, 20, "Save", function(box)
		local mine = state and state.mine
		if mine and not mine.logoUnlocked then
			send("UnlockLogo")
			return
		end
		send("SetLogo", { id = box.Text }, function(res)
			if res.ok then
				box.Text = ""
			end
		end)
	end)
	-- leaderboard banner position: live preview (same shape as a leaderboard row) + slider
	s.bannerTitle = sectionTitle(s.body, "LEADERBOARD BANNER  ·  DRAG TO PICK THE PART SHOWN", 32)
	local wrap = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 33 }, s.body)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 8) }, wrap)
	s.bannerWrap = wrap
	local preview = new("ImageLabel", { Name = "BannerPreview", BackgroundColor3 = FIELD, Size = UDim2.new(1, 0, 0, 40), LayoutOrder = 1 }, wrap)
	new("UIAspectRatioConstraint", { AspectRatio = 192 / 22, DominantAxis = Enum.DominantAxis.Width }, preview)
	corner(preview, 2)
	-- the banner itself, exactly as on the leaderboard: a strip of the logo at 80% of the row, centred, no dark wash
	local bannerImg = new("ImageLabel", {
		Name = "BannerImage", BackgroundTransparency = 1, Size = UDim2.fromScale(0.8, 0.8),
		AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5),
	}, preview)
	corner(bannerImg, 2)
	s.bannerText = text(preview, { Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -20, 1, 0), Font = BOLD, TextSize = 13, TextStrokeTransparency = 0.3, Text = "" })
	s.bannerPreview = bannerImg

	local track = new("TextButton", { Name = "BannerSlider", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 18), Text = "", AutoButtonColor = false, LayoutOrder = 2 }, wrap)
	local line = new("Frame", { AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.fromScale(0, 0.5), Size = UDim2.new(1, 0, 0, 3), BackgroundColor3 = LINE, BorderSizePixel = 0 }, track)
	corner(line, 2)
	local knob = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(12, 12), BackgroundColor3 = GOLD, BorderSizePixel = 0 }, track)
	corner(knob, 2)
	local ends = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 14), LayoutOrder = 3 }, wrap)
	text(ends, { Size = UDim2.fromScale(0.5, 1), TextSize = 10, TextColor3 = DIM, Text = "Top" })
	text(ends, { Position = UDim2.fromScale(0.5, 0), Size = UDim2.fromScale(0.5, 1), TextSize = 10, TextColor3 = DIM, TextXAlignment = Enum.TextXAlignment.Right, Text = "Bottom" })
	s.bannerTrack, s.bannerKnob = track, knob

	function s.showBanner(pos)
		s.bannerPos = pos
		knob.Position = UDim2.fromScale(pos, 0.5)
		FactionIcons.FitBanner(bannerImg, pos)
	end
	bannerImg:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
		FactionIcons.FitBanner(bannerImg, s.bannerPos or 0.5)
	end)
	local function posFrom(x)
		local w = track.AbsoluteSize.X
		return if w > 0 then math.clamp((x - track.AbsolutePosition.X) / w, 0, 1) else 0.5
	end
	track.InputBegan:Connect(function(input)
		if not track.Active then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			s.dragging = true
			s.showBanner(posFrom(input.Position.X))
		end
	end)
	UserInputService.InputChanged:Connect(function(input)
		if s.dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
			s.showBanner(posFrom(input.Position.X))
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if s.dragging and (input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch) then
			s.dragging = false
			send("SetBanner", { value = s.bannerPos }) -- saved once, on release
		end
	end)

	new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 6), LayoutOrder = 40 }, s.body)
	local function opt(keyName)
		return function()
			local mine = state and state.mine
			if mine then
				send("SetOption", { key = keyName, value = not mine[keyName] })
			end
		end
	end
	s.hideLogo = toggleRow(s.body, "Hide logo", "Members won't see the logo above each other.", 41, opt("hideLogo"))
	s.ffProtect = toggleRow(s.body, "Friendly fire", "On: members can't damage each other.", 42, opt("ffProtect"))
	s.joinRequests = toggleRow(s.body, "Join requests", "Let players ask to join. Leaders and officers decide.", 43, opt("joinRequests"))

	-- DaWest Rankings: link this faction to its site faction (FactionService.LinkSite) and show its
	-- site rating (DaWestRankings writes the DaWestFaction* attributes)
	new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 6), LayoutOrder = 49 }, s.body)
	s.site, s.siteBtn = fieldRow(s.body, "DAWEST RANKINGS LINK  ·  CODE FROM YOUR FACTION'S SITE PAGE", "Link code", 50, 12, "Link", function(box)
		send("LinkSite", { code = box.Text }, function(res)
			if res.ok then
				box.Text = ""
			end
		end)
	end)
	s.siteStatus = text(s.body, { Size = UDim2.new(1, 0, 0, 30), TextSize = 11, TextColor3 = DIM, TextWrapped = true, Text = "", LayoutOrder = 52 })
end

local function renderSettings()
	local s = ui.settings
	local mine = state and state.mine
	s.none.Visible = mine == nil
	s.body.Visible = mine ~= nil
	s.note.Visible = mine ~= nil and mine.myRank ~= "Leader"
	if not mine then
		return
	end
	local leader = mine.myRank == "Leader"
	s.name.PlaceholderText = mine.name
	s.tag.PlaceholderText = mine.tag or "No tag"
	s.logo.PlaceholderText = if mine.logoId > 0 then tostring(mine.logoId) else "Decal ID"
	s.logo.Visible = mine.logoUnlocked
	s.logoBtn.Text = if mine.logoUnlocked then "Save" else "Unlock · " .. price("LogoUnlock")
	s.logoBtn.Size = if mine.logoUnlocked then UDim2.new(0, 84, 1, 0) else UDim2.new(1, 0, 1, 0)
	s.logoBtn.Position = if mine.logoUnlocked then UDim2.new(1, -84, 0, 0) else UDim2.new()
	for _, box in { s.name, s.tag, s.logo } do
		box.TextEditable = leader
		box.Active = leader
		box.TextTransparency = if leader then 0 else 0.5
	end
	for _, b in { s.nameBtn, s.tagBtn, s.logoBtn } do
		setEnabled(b, leader)
	end
	local hasLogo = mine.logoUnlocked and mine.logoId > 0
	s.bannerTitle.Visible = hasLogo
	s.bannerWrap.Visible = hasLogo
	if hasLogo then
		s.bannerPreview.Image = FactionIcons.BannerImage(mine.logo)
		s.bannerText.Text = tagged(mine.tag, player.Name)
		s.bannerTrack.Active = leader
		s.bannerKnob.BackgroundColor3 = if leader then GOLD else DIM
		if not s.dragging then
			s.showBanner(mine.bannerPos or 0.5)
		end
	end
	s.hideLogo.set(mine.hideLogo, leader)
	s.ffProtect.set(mine.ffProtect, leader)
	s.joinRequests.set(mine.joinRequests, leader)

	s.site.TextEditable = leader
	s.site.Active = leader
	s.site.TextTransparency = if leader then 0 else 0.5
	setEnabled(s.siteBtn, leader)
	if player:GetAttribute("DaWestFactionLinked") == true then
		local tier = tostring(player:GetAttribute("DaWestFactionTier") or "")
		s.siteStatus.TextColor3 = GOLD
		s.siteStatus.Text = ("Linked to %s  ·  site rating %s  ·  #%s  ·  %s"):format(
			tostring(player:GetAttribute("DaWestFactionName") or "?"),
			tostring(math.floor(tonumber(player:GetAttribute("DaWestFactionRating")) or 0)),
			tostring(player:GetAttribute("DaWestFactionRank") or "?"),
			tier:sub(1, 1) .. tier:sub(2):lower()
		)
	else
		s.siteStatus.TextColor3 = DIM
		s.siteStatus.Text = if leader
			then "Not linked. On the site: your faction > Manage > Get link code, then enter it here. You must be the site faction's leader on this Roblox account."
			else "Not linked to a DaWest Rankings faction yet (the leader can link it)."
	end
end

----------------------------------------------------------------------------------------------
-- Factions tab
----------------------------------------------------------------------------------------------
local function buildFactions(page)
	local f = {}
	ui.factions = f
	local scroll = new("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollBarThickness = 2, ScrollBarImageColor3 = GOLD,
	}, page)
	new("UIPadding", { PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16), PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 16) }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6) }, scroll)

	-- create (only without a faction)
	local card = new("Frame", { Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = FIELD, BackgroundTransparency = 0.3, LayoutOrder = 1 }, scroll)
	corner(card, 2)
	stroke(card, GOLD, 0.7)
	new("UIPadding", { PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12), PaddingTop = UDim.new(0, 10), PaddingBottom = UDim.new(0, 12) }, card)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6) }, card)
	text(card, { Size = UDim2.new(1, 0, 0, 18), Font = BOLD, TextSize = 13, TextColor3 = GOLD, Text = "Create a faction", LayoutOrder = 1 })
	local r = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 28), LayoutOrder = 2 }, card)
	f.createName = textbox(r, ("Name (%d-%d)"):format(FC.NameMin, FC.NameMax), UDim2.new(1, -92, 1, 0), 1, FC.NameMax)
	f.createTag = textbox(r, "Tag (opt.)", UDim2.new(0, 84, 1, 0), 2, FC.TagMax)
	f.createTag.Position = UDim2.new(1, -84, 0, 0)
	local create = button(card, "Create faction", "primary", UDim2.new(1, 0, 0, 32), 3)
	create.Activated:Connect(function()
		send("Create", { name = f.createName.Text, tag = f.createTag.Text }, function(res)
			if res.ok then
				f.createName.Text, f.createTag.Text = "", ""
				FactionController.ShowTab("Members")
			end
		end)
	end)
	f.create = card

	f.title = sectionTitle(scroll, "IN THIS SERVER", 2)
	f.list = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 3 }, scroll)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }, f.list)
	f.empty = text(scroll, { Size = UDim2.new(1, 0, 0, 22), TextColor3 = DIM, Text = "No factions in this server yet.", LayoutOrder = 4 })
end

local function renderFactions()
	local f = ui.factions
	local mine = state and state.mine
	f.create.Visible = state ~= nil and mine == nil
	clear(f.list)
	local list = state and state.list or {}
	f.title.Text = ("IN THIS SERVER  %d"):format(#list)
	f.empty.Visible = #list == 0
	for i, fac in list do
		local ranking = siteFaction(fac.id)
		local wrap = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = i }, f.list)
		new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder }, wrap)
		local r = new("TextButton", { Size = UDim2.new(1, 0, 0, if ranking then 64 else 44), BackgroundColor3 = FIELD, BackgroundTransparency = 0.35, AutoButtonColor = false, Text = "", LayoutOrder = 1 }, wrap)
		corner(r)
		local logo = FactionIcons.Logo(r, 26, fac.logo, true, CREAM)
		logo.Position = UDim2.fromOffset(10, 9)
		local isMine = mine and mine.id == fac.id
		text(r, { Position = UDim2.fromOffset(46, 5), Size = UDim2.new(1, -150, 0, 18), Text = tagged(fac.tag, fac.name), TextColor3 = if isMine then GOLD else CREAM })
		text(r, { Position = UDim2.fromOffset(46, 23), Size = UDim2.new(1, -150, 0, 15), TextSize = 11, TextColor3 = DIM, Text = ("%d/%d members"):format(fac.members, fac.capacity) })
		if ranking then
			text(r, {
				Name = "VerifiedFactionStanding", Position = UDim2.fromOffset(46, 42),
				Size = UDim2.new(1, -54, 0, 16), TextSize = 11,
				TextColor3 = Color3.fromRGB(183, 213, 245),
				Text = "✓ Verified  ·  " .. siteStanding(ranking),
			})
		end
		local right = UDim2.new(1, -8, 0, 22)
		if not mine then
			if fac.requested then
				local b = button(r, "Requested", "ghost", UDim2.fromOffset(88, 26))
				b.AnchorPoint, b.Position = Vector2.new(1, 0.5), right
				b.Activated:Connect(function()
					send("CancelRequest", { faction = fac.id })
				end)
			elseif fac.joinRequests and fac.members < fac.capacity then
				local b = button(r, "Request", "primary", UDim2.fromOffset(88, 26))
				b.AnchorPoint, b.Position = Vector2.new(1, 0.5), right
				b.Activated:Connect(function()
					send("RequestJoin", { faction = fac.id })
				end)
			else
				local l = text(r, { AnchorPoint = Vector2.new(1, 0.5), Position = right, Size = UDim2.fromOffset(88, 20), TextXAlignment = Enum.TextXAlignment.Right, TextSize = 11, TextColor3 = DIM, Text = if fac.members >= fac.capacity then "Full" else "Invite only" })
				l.Font = BOLD
			end
		elseif isMine then
			text(r, { AnchorPoint = Vector2.new(1, 0.5), Position = right, Size = UDim2.fromOffset(88, 20), TextXAlignment = Enum.TextXAlignment.Right, TextSize = 11, Font = BOLD, TextColor3 = GOLD, Text = "Your faction" })
		end
		local info = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 2, Visible = expanded[fac.id] == true }, wrap)
		new("UIPadding", { PaddingLeft = UDim.new(0, 46), PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 6), PaddingRight = UDim.new(0, 8) }, info)
		new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 2) }, info)
		local function line(label, value, order)
			text(info, {
				Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextWrapped = true, TextTruncate = Enum.TextTruncate.None,
				TextSize = 12, RichText = true, LayoutOrder = order,
				Text = ('<font color="#928F89">%s</font>  %s'):format(label, value),
			})
		end
		line("Leader", fac.leader, 1)
		line("Online", table.concat(fac.online, ", "), 2)
		line("Join requests", if fac.joinRequests then "Open" else "Closed", 3)
		if ranking then
			line("Verified faction", siteRank(ranking), 4)
			line("Elo", if ranking.rating then tostring(math.floor(ranking.rating + 0.5)) else "Pending", 5)
			line("Tier", ranking.tier:sub(1, 1) .. ranking.tier:sub(2):lower(), 6)
		end
		r.Activated:Connect(function()
			expanded[fac.id] = not expanded[fac.id]
			info.Visible = expanded[fac.id]
			if info.Visible then
				info.Size = UDim2.new(1, 0, 0, 0)
			end
		end)
	end
end

----------------------------------------------------------------------------------------------
-- window
----------------------------------------------------------------------------------------------
local function render()
	if not ui.window then
		return
	end
	renderHeader()
	renderMembers()
	renderSettings()
	renderFactions()
end

-- The player attributes continue to update the Settings tab and faction header.
for _, attr in { "DaWestFactionLinked", "DaWestFactionRating", "DaWestFactionRank", "DaWestFactionName" } do
	player:GetAttributeChangedSignal(attr):Connect(function()
		if ui.window and ui.settings then
			renderHeader()
			renderSettings()
		end
	end)
end

-- React to records arriving, changing rank, or being removed after unlinking.
task.spawn(function()
	local root = ReplicatedStorage:WaitForChild("DaWestRankings", 10)
	local ratings = root and root:WaitForChild("FactionRatings", 10)
	if not ratings then return end
	local queued = false
	local function refreshStandings()
		if queued then return end
		queued = true
		task.defer(function()
			queued = false
			if ui.window and ui.factions and ui.settings then
				renderHeader()
				renderFactions()
				renderSettings()
			end
		end)
	end
	local function watch(record)
		record.AttributeChanged:Connect(refreshStandings)
		refreshStandings()
	end
	ratings.ChildAdded:Connect(watch)
	ratings.ChildRemoved:Connect(refreshStandings)
	for _, record in ratings:GetChildren() do watch(record) end
end)

function FactionController.ShowTab(name)
	if not ui.pages[name] then
		return
	end
	local changed = name ~= currentTab
	currentTab = name
	for tabName, b in ui.tabButtons do
		tween(b, 0.15, { TextColor3 = if tabName == name then CREAM else DIM })
	end
	local b = ui.tabButtons[name]
	tween(ui.underline, 0.2, { Position = UDim2.new(b.Position.X.Scale, 16, 1, -2) })
	for tabName, page in ui.pages do
		if tabName == name then
			page.Visible = true
			if changed then
				page.GroupTransparency = 1
				page.Position = UDim2.fromOffset(0, 8)
				tween(page, 0.2, { GroupTransparency = 0, Position = UDim2.fromOffset(0, 0) })
			end
		else
			page.Visible = false
		end
	end
end

local function fitHeight()
	local cam = workspace.CurrentCamera
	if not (cam and ui.window) then
		return
	end
	local s = ui.scale.Scale
	local avail = cam.ViewportSize.Y / s - 80
	ui.window.Size = UDim2.fromOffset(WIDTH, math.clamp(avail, 320, MAX_HEIGHT))
end

local function build()
	local gui = new("ScreenGui", { Name = "FactionUI", ResetOnSpawn = false, IgnoreGuiInset = true, DisplayOrder = 25, ZIndexBehavior = Enum.ZIndexBehavior.Sibling }, player:WaitForChild("PlayerGui"))
	ui.scale = new("UIScale", {}, gui)
	local function rescale()
		local cam = workspace.CurrentCamera
		ui.scale.Scale = if cam then math.clamp(cam.ViewportSize.Y / 1080, 0.75, 1.35) else 1
		fitHeight()
	end

	-- toasts (top centre)
	ui.toasts = new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 64), Size = UDim2.fromOffset(300, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1 }, gui)
	new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center }, ui.toasts)

	local win = new("CanvasGroup", {
		Name = "Window", AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(WIDTH, MAX_HEIGHT),
		BackgroundColor3 = PANEL, BackgroundTransparency = 0.04, Visible = false, GroupTransparency = 1,
	}, gui)
	corner(win, 2)
	stroke(win, GOLD, 0.75)
	CollectionService:AddTag(win, MovementConfig.Cursor.FreeCursorTag or "FreeCursor")
	ui.window = win

	-- title
	text(win, { Position = UDim2.fromOffset(16, 10), Size = UDim2.new(1, -60, 0, 24), Font = Enum.Font.GrenzeGotisch, TextSize = 24, TextColor3 = CREAM, Text = "Factions" })
	local close = new("TextButton", { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 8), Size = UDim2.fromOffset(28, 28), BackgroundTransparency = 1, Text = "" }, win)
	local bars = {}
	for _, rot in { 45, -45 } do
		table.insert(bars, new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(13, 2), Rotation = rot, BackgroundColor3 = DIM, BorderSizePixel = 0 }, close))
	end
	close.MouseEnter:Connect(function()
		for _, b in bars do
			b.BackgroundColor3 = CREAM
		end
	end)
	close.MouseLeave:Connect(function()
		for _, b in bars do
			b.BackgroundColor3 = DIM
		end
	end)
	close.Activated:Connect(function()
		FactionController.SetOpen(false)
	end)

	-- tabs
	local tabs = new("Frame", { Position = UDim2.fromOffset(0, 40), Size = UDim2.new(1, 0, 0, 32), BackgroundTransparency = 1 }, win)
	for i, name in TABS do
		local b = new("TextButton", {
			Position = UDim2.new((i - 1) / #TABS, 0, 0, 0), Size = UDim2.new(1 / #TABS, 0, 1, 0), BackgroundTransparency = 1,
			Font = BOLD, TextSize = 13, Text = name, TextColor3 = if name == currentTab then CREAM else DIM, AutoButtonColor = false,
		}, tabs)
		b.Activated:Connect(function()
			FactionController.ShowTab(name)
		end)
		ui.tabButtons[name] = b
	end
	new("Frame", { Position = UDim2.new(0, 0, 1, -1), Size = UDim2.new(1, 0, 0, 1), BackgroundColor3 = LINE, BorderSizePixel = 0 }, tabs)
	ui.underline = new("Frame", { Position = UDim2.new(0, 16, 1, -2), Size = UDim2.new(1 / #TABS, -32, 0, 2), BackgroundColor3 = GOLD, BorderSizePixel = 0 }, tabs)

	-- header
	local header = new("Frame", { Position = UDim2.fromOffset(0, 72), Size = UDim2.new(1, 0, 0, 90), BackgroundTransparency = 1 }, win)
	local h = {}
	h.logo = FactionIcons.Logo(header, 40, "", true, CREAM)
	h.logo.Position = UDim2.fromOffset(16, 14)
	h.name = text(header, { Position = UDim2.fromOffset(68, 12), Size = UDim2.new(1, -200, 0, 24), Font = Enum.Font.GrenzeGotisch, TextSize = 22, Text = "" })
	h.sub = text(header, { Position = UDim2.fromOffset(68, 36), Size = UDim2.new(1, -200, 0, 16), TextSize = 11, TextColor3 = DIM, Text = "" })
	h.count = text(header, { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -16, 0, 12), Size = UDim2.fromOffset(110, 18), TextXAlignment = Enum.TextXAlignment.Right, Font = BOLD, TextSize = 14, Text = "" })
	h.slots = button(header, "+5 slots", "primary", UDim2.fromOffset(110, 24))
	h.slots.AnchorPoint = Vector2.new(1, 0)
	h.slots.Position = UDim2.new(1, -16, 0, 34)
	h.slots.TextSize = 11
	h.ranking = text(header, {
		Name = "FactionStanding", Position = UDim2.fromOffset(16, 63),
		Size = UDim2.new(1, -32, 0, 16), Font = BOLD, TextSize = 11, Text = "",
	})
	h.slots.Activated:Connect(function()
		if h.slots.Active then
			send("BuySlots")
		end
	end)
	new("Frame", { Position = UDim2.new(0, 16, 1, -1), Size = UDim2.new(1, -32, 0, 1), BackgroundColor3 = LINE, BorderSizePixel = 0 }, header)
	ui.header = h

	-- pages
	local content = new("Frame", { Position = UDim2.fromOffset(0, 162), Size = UDim2.new(1, 0, 1, -162), BackgroundTransparency = 1, ClipsDescendants = true }, win)
	for _, name in TABS do
		ui.pages[name] = new("CanvasGroup", { Name = name, Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = name == currentTab }, content)
	end
	buildMembers(ui.pages.Members)
	buildSettings(ui.pages.Settings)
	buildFactions(ui.pages.Factions)

	rescale()
	workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
	render()
end

----------------------------------------------------------------------------------------------
-- public
----------------------------------------------------------------------------------------------
local Keybinds = require(game:GetService("ReplicatedStorage"):WaitForChild("Combat"):WaitForChild("Keybinds"))
function FactionController.IsKey(input)
	return Keybinds.Matches("Factions", input) -- rebindable (Settings > Controls); default FC.OpenKey
end

function FactionController.IsOpen()
	return isOpen
end

function FactionController.SetOpen(on)
	if not ui.window or on == isOpen then
		return
	end
	isOpen = on
	local win = ui.window
	if on then
		if Ctx and Ctx.WeaponMenu and Ctx.WeaponMenu.Close then
			Ctx.WeaponMenu.Close()
		end
		fitHeight()
		win.Visible = true
		win.Position = UDim2.new(0.5, 0, 0.5, 10)
		tween(win, 0.2, { GroupTransparency = 0, Position = UDim2.fromScale(0.5, 0.5) })
		if Sync then
			Sync:FireServer() -- fresh view
		end
	else
		ui.members.suggest.Visible = false
		local tw = tween(win, 0.15, { GroupTransparency = 1, Position = UDim2.new(0.5, 0, 0.5, 10) })
		tw.Completed:Connect(function()
			if not isOpen then
				win.Visible = false
			end
		end)
	end
end

function FactionController.Toggle()
	FactionController.SetOpen(not isOpen)
end

function FactionController.Init(ctx)
	Ctx = ctx
	task.spawn(function()
		build()
		local remotes = Factions:WaitForChild("Remotes")
		Request = remotes:WaitForChild("Request")
		Sync = remotes:WaitForChild("Sync")
		Notify = remotes:WaitForChild("Notify")
		Sync.OnClientEvent:Connect(function(snapshot)
			if type(snapshot) ~= "table" then
				return
			end
			state = snapshot
			-- a new invite pops up even with the menu closed
			local current = {}
			for _, inv in snapshot.invites or {} do
				current[inv.faction] = true
				if not seenInvites[inv.faction] then
					toast(("%s invited you to %s."):format(inv.from, tagged(inv.tag, inv.name)), "info", {
						{ label = "Join", style = "primary", callback = function()
							send("AnswerInvite", { faction = inv.faction, accept = true })
						end },
						{ label = "Decline", style = "ghost", callback = function()
							send("AnswerInvite", { faction = inv.faction, accept = false })
						end },
					}, math.min(inv.seconds or 30, 30))
				end
			end
			seenInvites = current
			render()
		end)
		Notify.OnClientEvent:Connect(function(n)
			if type(n) == "table" and n.kind ~= "invite" then
				toast(n.text, n.kind)
			end
		end)
		Sync:FireServer()
	end)
end

return FactionController
