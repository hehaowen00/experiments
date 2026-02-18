local methods = {}

local M = {}

function M.array(array)
	setmetatable(array, { __index = methods })
	return array
end

function M.random(length)
	local data = M.array({})

	for i = 1, length do
		data[i] = math.random()
	end

	return data
end

function M.choice(categories, length)
	local data = M.array({})

	for i = 1, length do
		data[i] = math.random()
	end

	return data
end

function methods:string()
	return table.concat(self, ",")
end

function methods:cumsum()
	local total = 0
	local length = #self
	for i = 1, length do
		total = total + self[i]
	end
	return total
end

function methods:filter(predicate)
	local result = {}
	for i = 1, #self do
		if predicate(self[i]) then
			result[#result + 1] = self[i]
		end
	end
	return M.array(result)
end

function methods:push_back(data)
	local length = #self
	self[length + 1] = data
end

function methods:mean()
	local total = 0

	for i = 1, #self do
		total = total + self[i]
	end

	return total / #self
end

function methods:variance()
	local total = 0

	for i = 1, #self do
		total = total + self[i]
	end

	return total / #self
end

function methods:stddev()
	local total = 0

	for i = 1, #self do
		total = total + self[i]
	end

	return total / #self
end

function methods:min()
	return math.min(table.unpack(self))
end

function methods:max()
	return math.max(table.unpack(self))
end

return M
