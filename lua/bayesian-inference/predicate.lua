local M = {}

function M.equals(x)
	return function(i)
		return i == x
	end
end

function M.lt(x)
	return function(i)
		return i < x
	end
end

function M.gt(x)
	return function(i)
		return i > x
	end
end

function M.lte(x)
	return function(i)
		return i <= x
	end
end

function M.gte(x)
	return function(i)
		return i >= x
	end
end

return M
